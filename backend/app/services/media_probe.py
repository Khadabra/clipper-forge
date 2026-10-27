"""
media_probe.py — Safe ffprobe wrapper for media metadata extraction.

Calls ffprobe via subprocess list (never shell=True) to avoid injection risks.
Returns a structured dict or raises MediaProbeError on failure.
"""
from __future__ import annotations

import json
import subprocess
from fractions import Fraction
from pathlib import Path
from typing import TypedDict


class VideoMetadata(TypedDict):
    duration: float
    width: int
    height: int
    fps: float
    audio_channels: int | None


class MediaProbeError(Exception):
    """Raised when ffprobe fails or returns unexpected output."""


def _parse_fps(rate_str: str) -> float:
    """
    Parse a framerate string such as '30/1', '60000/1001', or '25' into a float.
    Falls back to 0.0 if parsing fails.
    """
    try:
        frac = Fraction(rate_str)
        return round(float(frac), 4)
    except (ValueError, ZeroDivisionError):
        return 0.0


def probe(file_path: Path | str) -> VideoMetadata:
    """
    Run ffprobe on *file_path* and extract essential video metadata.

    Args:
        file_path: Absolute path to the media file.

    Returns:
        VideoMetadata TypedDict with duration, width, height, fps, audio_channels.

    Raises:
        MediaProbeError: If ffprobe is unavailable, the file is corrupt,
                         or no video stream is found.
        FileNotFoundError: If the given path does not exist.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Media file not found: {path}")

    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        "-show_format",
        str(path),
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except FileNotFoundError:
        raise MediaProbeError(
            "ffprobe executable not found. Ensure FFmpeg is installed and on PATH."
        )
    except subprocess.TimeoutExpired:
        raise MediaProbeError(f"ffprobe timed out after 60 seconds for: {path.name}")

    if result.returncode != 0:
        stderr = result.stderr.strip()
        raise MediaProbeError(
            f"ffprobe returned non-zero exit code {result.returncode} "
            f"for '{path.name}': {stderr[:256]}"
        )

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise MediaProbeError(f"ffprobe output is not valid JSON: {exc}") from exc

    streams = data.get("streams", [])
    fmt = data.get("format", {})

    # ── Video stream ─────────────────────────────────────────────────────────
    video_stream = next(
        (s for s in streams if s.get("codec_type") == "video"), None
    )
    if video_stream is None:
        raise MediaProbeError(
            f"No video stream found in '{path.name}'. "
            "File may be audio-only or unsupported."
        )

    width: int = int(video_stream.get("width", 0))
    height: int = int(video_stream.get("height", 0))

    # Prefer avg_frame_rate; fall back to r_frame_rate
    fps_raw = video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate", "0/1")
    fps: float = _parse_fps(fps_raw)

    # ── Duration ─────────────────────────────────────────────────────────────
    # Prefer format-level duration (more reliable for containers like MKV)
    raw_duration = fmt.get("duration") or video_stream.get("duration", "0")
    try:
        duration: float = round(float(raw_duration), 3)
    except (ValueError, TypeError):
        duration = 0.0

    # ── Audio channels ───────────────────────────────────────────────────────
    audio_stream = next(
        (s for s in streams if s.get("codec_type") == "audio"), None
    )
    audio_channels: int | None = (
        int(audio_stream.get("channels", 0)) if audio_stream else None
    )

    return VideoMetadata(
        duration=duration,
        width=width,
        height=height,
        fps=fps,
        audio_channels=audio_channels,
    )
