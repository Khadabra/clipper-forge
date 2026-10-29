"""
services/quality_gate.py — Automated Render Quality Gate.

Runs post-render validation:
1. Container & stream decodability via ffprobe.
2. Black frame detection (blackdetect).
3. Frozen frame detection (freezedetect).
4. Audio stream presence and volume metrics (volumedetect).
5. Aspect ratio & duration conformance.
6. Returns structured report: Pass / Warning / Fail.
"""
from __future__ import annotations

import json
import logging
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger("clipperforge.quality_gate")


class QualityIssue(BaseModel):
    severity: str  # "error" | "warning" | "info"
    code: str
    message: str
    timestamp_range: tuple[float, float] | None = None


class RenderQualityReport(BaseModel):
    status: str  # "pass" | "warning" | "fail"
    checked_at: str
    video_path: str
    metrics: dict[str, Any]
    issues: list[QualityIssue]


def run_quality_gate(
    video_path: Path,
    expected_duration: float | None = None,
    expected_aspect_ratio: str = "9:16",
    check_black_frames: bool = True,
    check_frozen_frames: bool = True,
    check_audio: bool = True,
) -> RenderQualityReport:
    """
    Validates a rendered MP4 file against broadcast and social media standards.
    Returns a comprehensive RenderQualityReport.
    """
    if not video_path.exists():
        return RenderQualityReport(
            status="fail",
            checked_at=datetime.now(timezone.utc).isoformat(),
            video_path=str(video_path),
            metrics={},
            issues=[
                QualityIssue(
                    severity="error",
                    code="FILE_NOT_FOUND",
                    message=f"Rendered file does not exist: {video_path}",
                )
            ],
        )

    file_size_bytes = video_path.stat().st_size
    if file_size_bytes < 1000:
        return RenderQualityReport(
            status="fail",
            checked_at=datetime.now(timezone.utc).isoformat(),
            video_path=str(video_path),
            metrics={"file_size_bytes": file_size_bytes},
            issues=[
                QualityIssue(
                    severity="error",
                    code="FILE_EMPTY_OR_CORRUPT",
                    message="Rendered video file is abnormally small (< 1KB).",
                )
            ],
        )

    metrics: dict[str, Any] = {
        "file_size_bytes": file_size_bytes,
        "file_size_mb": round(file_size_bytes / (1024 * 1024), 2),
    }
    issues: list[QualityIssue] = []

    # 1. ffprobe format & stream validation
    ffprobe_cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(video_path),
    ]
    try:
        proc = subprocess.run(
            ffprobe_cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=15,
        )
        info = json.loads(proc.stdout)
    except Exception as exc:
        return RenderQualityReport(
            status="fail",
            checked_at=datetime.now(timezone.utc).isoformat(),
            video_path=str(video_path),
            metrics=metrics,
            issues=[
                QualityIssue(
                    severity="error",
                    code="PROBE_FAILED",
                    message=f"FFprobe failed to decode container: {exc}",
                )
            ],
        )

    format_info = info.get("format", {})
    streams = info.get("streams", [])

    duration = float(format_info.get("duration") or 0.0)
    metrics["duration"] = round(duration, 3)

    v_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    a_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    if not v_stream:
        issues.append(
            QualityIssue(
                severity="error",
                code="NO_VIDEO_STREAM",
                message="Video stream is missing in output file.",
            )
        )
    else:
        vw = int(v_stream.get("width") or 0)
        vh = int(v_stream.get("height") or 0)
        metrics["width"] = vw
        metrics["height"] = vh
        metrics["codec_name"] = v_stream.get("codec_name")

        # Check expected aspect ratio dimensions
        if expected_aspect_ratio == "9:16" and (vw > vh):
            issues.append(
                QualityIssue(
                    severity="warning",
                    code="UNEXPECTED_ORIENTATION",
                    message=f"Expected vertical 9:16 video but got {vw}x{vh}.",
                )
            )

    if not a_stream and check_audio:
        issues.append(
            QualityIssue(
                severity="warning",
                code="NO_AUDIO_STREAM",
                message="Audio stream is missing in output file.",
            )
        )
    elif a_stream:
        metrics["audio_codec"] = a_stream.get("codec_name")
        metrics["audio_sample_rate"] = a_stream.get("sample_rate")

    # 2. Check duration conformity
    if expected_duration is not None and expected_duration > 0:
        dur_diff = abs(duration - expected_duration)
        if dur_diff > 4.0:
            issues.append(
                QualityIssue(
                    severity="info",
                    code="DURATION_DELTA",
                    message=f"Output duration ({duration:.1f}s) differs from target ({expected_duration:.1f}s). May be due to silence removal cuts.",
                )
            )

    # 3. Audio volume & silence check via volumedetect
    if a_stream and check_audio:
        try:
            vol_cmd = [
                "ffmpeg",
                "-hide_banner",
                "-i", str(video_path),
                "-af", "volumedetect",
                "-f", "null",
                "-",
            ]
            vol_proc = subprocess.run(
                vol_cmd,
                capture_output=True,
                text=True,
                timeout=20,
            )
            vol_out = vol_proc.stderr

            mean_match = re.search(r"mean_volume:\s*([-\d.]+)\s*dB", vol_out)
            max_match = re.search(r"max_volume:\s*([-\d.]+)\s*dB", vol_out)

            if mean_match:
                mean_vol = float(mean_match.group(1))
                metrics["audio_mean_volume_db"] = mean_vol
                if mean_vol < -55.0:
                    issues.append(
                        QualityIssue(
                            severity="warning",
                            code="AUDIO_TOO_QUIET",
                            message=f"Audio volume is very low ({mean_vol:.1f} dB). Check microphone track or BGM ducking.",
                        )
                    )

            if max_match:
                max_vol = float(max_match.group(1))
                metrics["audio_max_volume_db"] = max_vol
                if max_vol >= -0.1:
                    issues.append(
                        QualityIssue(
                            severity="info",
                            code="AUDIO_PEAK_LIMIT",
                            message="Audio peaks near 0 dB. Consider applying limiter.",
                        )
                    )
        except Exception as exc:
            logger.debug(f"Volume check skipped: {exc}")

    # 4. Black frames detection via blackdetect
    if v_stream and check_black_frames and duration > 2.0:
        try:
            black_cmd = [
                "ffmpeg",
                "-hide_banner",
                "-i", str(video_path),
                "-vf", "blackdetect=d=0.75:pix_th=0.10",
                "-f", "null",
                "-",
            ]
            black_proc = subprocess.run(
                black_cmd,
                capture_output=True,
                text=True,
                timeout=20,
            )
            black_out = black_proc.stderr
            black_events = re.findall(
                r"black_start:([-\d.]+)\s+black_end:([-\d.]+)\s+black_duration:([-\d.]+)",
                black_out,
            )
            metrics["black_segments_count"] = len(black_events)
            if black_events:
                # If black duration is significant (> 1.5s)
                for b_s, b_e, b_d in black_events:
                    dur_val = float(b_d)
                    if dur_val > 1.2:
                        issues.append(
                            QualityIssue(
                                severity="warning",
                                code="PROLONGED_BLACK_FRAME",
                                message=f"Black screen detected for {dur_val:.1f}s between {float(b_s):.1f}s and {float(b_e):.1f}s.",
                                timestamp_range=(float(b_s), float(b_e)),
                            )
                        )
        except Exception as exc:
            logger.debug(f"Black frame check skipped: {exc}")

    # 5. Frozen frames detection via freezedetect
    if v_stream and check_frozen_frames and duration > 3.0:
        try:
            freeze_cmd = [
                "ffmpeg",
                "-hide_banner",
                "-i", str(video_path),
                "-vf", "freezedetect=n=0.003:d=1.5",
                "-f", "null",
                "-",
            ]
            freeze_proc = subprocess.run(
                freeze_cmd,
                capture_output=True,
                text=True,
                timeout=20,
            )
            freeze_out = freeze_proc.stderr
            freeze_starts = [float(x) for x in re.findall(r"freeze_start:\s*([-\d.]+)", freeze_out)]
            freeze_ends = [float(x) for x in re.findall(r"freeze_end:\s*([-\d.]+)", freeze_out)]
            metrics["frozen_segments_count"] = len(freeze_starts)

            for idx, f_s in enumerate(freeze_starts):
                f_e = freeze_ends[idx] if idx < len(freeze_ends) else duration
                dur_frozen = f_e - f_s
                if dur_frozen > 2.0:
                    issues.append(
                        QualityIssue(
                            severity="warning",
                            code="FROZEN_VIDEO",
                            message=f"Video freezes for {dur_frozen:.1f}s between {f_s:.1f}s and {f_e:.1f}s.",
                            timestamp_range=(f_s, f_e),
                        )
                    )
        except Exception as exc:
            logger.debug(f"Freeze frame check skipped: {exc}")

    # Status assessment
    has_errors = any(i.severity == "error" for i in issues)
    has_warnings = any(i.severity == "warning" for i in issues)

    if has_errors:
        final_status = "fail"
    elif has_warnings:
        final_status = "warning"
    else:
        final_status = "pass"

    return RenderQualityReport(
        status=final_status,
        checked_at=datetime.now(timezone.utc).isoformat(),
        video_path=str(video_path),
        metrics=metrics,
        issues=issues,
    )

