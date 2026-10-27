"""
services/audio_extractor.py — Audio extraction service using FFmpeg.

Extracts audio from video files into 16kHz, mono, 16-bit PCM WAV format
which is the optimal format for Whisper / faster-whisper transcription.
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger("clipperforge.audio_extractor")


class AudioExtractionError(Exception):
    """Raised when audio extraction from video fails."""
    pass


def extract_audio(
    video_path: str | Path,
    output_path: str | Path,
) -> Path:
    """
    Extract audio from video to 16kHz mono PCM 16-bit WAV file.

    Parameters:
        video_path: Path to source video file.
        output_path: Path where audio.wav will be written.

    Returns:
        Path to the generated WAV file.

    Raises:
        FileNotFoundError: If input video does not exist.
        AudioExtractionError: If FFmpeg fails or cannot be executed.
    """
    input_file = Path(video_path)
    if not input_file.exists():
        raise FileNotFoundError(f"Input video file not found: {input_file}")

    target_file = Path(output_path)
    target_file.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg",
        "-y",               # Overwrite output without asking
        "-i", str(input_file),
        "-vn",              # Disable video recording
        "-acodec", "pcm_s16le", # 16-bit linear PCM
        "-ar", "16000",     # 16 kHz sample rate (optimal for Whisper)
        "-ac", "1",         # Mono channel
        str(target_file),
    ]

    logger.info(f"Extracting audio from '{input_file}' to '{target_file}'")

    try:
        process = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        raise AudioExtractionError(
            "FFmpeg executable not found. Ensure FFmpeg is installed and added to PATH."
        )
    except Exception as exc:
        raise AudioExtractionError(f"Unexpected error executing FFmpeg: {exc}") from exc

    if process.returncode != 0:
        error_msg = process.stderr.strip() or f"FFmpeg exited with code {process.returncode}"
        logger.error(f"FFmpeg extraction failed: {error_msg}")
        raise AudioExtractionError(f"FFmpeg audio extraction failed: {error_msg}")

    if not target_file.exists() or target_file.stat().st_size == 0:
        raise AudioExtractionError("Audio file was not created or is empty.")

    logger.info(f"Audio extracted successfully: {target_file} ({target_file.stat().st_size} bytes)")
    return target_file
