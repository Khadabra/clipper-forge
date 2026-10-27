"""
services/video_renderer.py — Video Cropping, 9:16 Aspect Ratio Conversion,
Subtitle Burn-in, and Hardware-Accelerated Rendering Engine.

Executes FFmpeg via list array subprocess with support for:
- 9:16 Vertical (Shorts/TikTok/Reels), 1:1 Square, and 16:9 Landscape
- Blur background fill vs center crop modes
- ASS subtitle burn-in
- Auto-detection of NVIDIA NVENC hardware encoder with libx264 CPU fallback
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from typing import Any, Callable

from app.services.subtitle_burner import (
    create_clip_subtitle_file,
    escape_ffmpeg_filter_path,
)

logger = logging.getLogger("clipperforge.video_renderer")

_NVENC_CHECKED = False
_NVENC_AVAILABLE = False


def check_nvenc_available() -> bool:
    """
    Check if NVIDIA h264_nvenc encoder is actually functional on this machine.
    Runs a 1-frame smoke test to verify Nvidia driver NVENC API version compatibility.
    """
    global _NVENC_CHECKED, _NVENC_AVAILABLE
    if _NVENC_CHECKED:
        return _NVENC_AVAILABLE

    try:
        # 1. Quick check if FFmpeg binary was compiled with h264_nvenc
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if "h264_nvenc" not in (proc.stdout or ""):
            _NVENC_AVAILABLE = False
            _NVENC_CHECKED = True
            return False

        # 2. Smoke test: encode 1 tiny frame to verify driver API compatibility (e.g. NVENC API 13.x vs driver version)
        smoke_cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x64:d=0.04",
            "-c:v",
            "h264_nvenc",
            "-f",
            "null",
            "-",
        ]
        smoke_proc = subprocess.run(
            smoke_cmd,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        _NVENC_AVAILABLE = (smoke_proc.returncode == 0)
        if not _NVENC_AVAILABLE:
            logger.info(
                f"NVENC encoder compiled in FFmpeg but driver smoke test failed (code {smoke_proc.returncode}). Using CPU libx264."
            )
    except Exception as exc:
        logger.warning(f"Could not probe for NVENC encoder: {exc}. Defaulting to CPU.")
        _NVENC_AVAILABLE = False

    _NVENC_CHECKED = True
    logger.info(f"Hardware NVENC encoder functional: {_NVENC_AVAILABLE}")
    return _NVENC_AVAILABLE


def get_target_dimensions(aspect_ratio: str) -> tuple[int, int]:
    """Return (width, height) for target aspect ratio."""
    if aspect_ratio == "1:1":
        return 1080, 1080
    elif aspect_ratio == "16:9":
        return 1920, 1080
    # default vertical 9:16
    return 1080, 1920


def build_filter_graph(
    aspect_ratio: str = "9:16",
    crop_mode: str = "blur_fill",
    ass_sub_path: Path | None = None,
    auto_zoom: str = "none",
    clip_duration: float = 30.0,
    speaker_crop_expr: str | None = None,
) -> tuple[str, str]:
    """
    Build FFmpeg -filter_complex string and the final video output label.
    Supports layout cropping presets, dynamic retention auto-zoom patterns,
    active speaker tracking switching, and ASS subtitle burn-in.
    Returns: (filter_complex_str, final_v_label)
    """
    target_w, target_h = get_target_dimensions(aspect_ratio)

    filter_chains: list[str] = []

    if crop_mode == "center_crop":
        # Standard centered 9:16 crop
        crop_label = "[v_cropped]" if auto_zoom == "none" else "[v_base]"
        crop_chain = (
            f"[0:v]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
            f"crop={target_w}:{target_h}:(in_w-{target_w})/2:(in_h-{target_h})/2{crop_label}"
        )
        filter_chains.append(crop_chain)
        current_v_label = crop_label

    elif crop_mode == "framed_headline":
        # 16:9 centered video with black top/bottom bars for hook headline banner
        framed_label = "[v_framed]" if auto_zoom == "none" else "[v_base]"
        framed_chain = (
            f"[0:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
            f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:black{framed_label}"
        )
        filter_chains.append(framed_chain)
        current_v_label = framed_label

    elif crop_mode == "speaker_track":
        # Active Speaker Tracking & Dynamic Camera Switching between speakers
        speaker_label = "[v_speaker_track]" if auto_zoom == "none" else "[v_base]"
        crop_x = speaker_crop_expr or "if(mod(floor(t/4),2),2020,314)"
        crop_chain = (
            f"[0:v]scale=3414:{target_h}:force_original_aspect_ratio=increase,"
            f"crop={target_w}:{target_h}:x='{crop_x}':y='(in_h-{target_h})/2'{speaker_label}"
        )
        filter_chains.append(crop_chain)
        current_v_label = speaker_label

    else:
        # Default 'blur_fill'
        compose_label = "[v_composed]" if auto_zoom == "none" else "[v_base]"
        if aspect_ratio == "16:9":
            fill_chain = (
                f"[0:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
                f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2{compose_label}"
            )
            filter_chains.append(fill_chain)
        else:
            fill_chain = (
                f"[0:v]split=2[bg_raw][fg_raw];"
                f"[bg_raw]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{target_h}:(in_w-{target_w})/2:(in_h-{target_h})/2,"
                f"boxblur=25:5[bg_blur];"
                f"[fg_raw]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease[fg_scaled];"
                f"[bg_blur][fg_scaled]overlay=(W-w)/2:(H-h)/2{compose_label}"
            )
            filter_chains.append(fill_chain)
        current_v_label = compose_label

    # Apply Curated Dynamic Auto-Zoom Patterns: 'subtle' (1.12x breathing) & 'snap_hook' (1.20x in first 3s)
    if auto_zoom in ("subtle", "snap_hook", "punchy"):
        if auto_zoom == "snap_hook":
            # Jump-cut 1.20x zoom during first 3 seconds hook, then snap back to 1.0x
            zoom_expr = "if(lte(t,3),1.20,1.00)"
        elif auto_zoom == "punchy":
            # Backward-compatible punchy 1.20x breathing
            zoom_expr = "(1+0.2*(0.5-0.5*cos(2*PI*t/4.0)))"
        else:
            # Subtle 1.12x Hann breathing zoom every 5 seconds
            zoom_expr = "(1+0.12*(0.5-0.5*cos(2*PI*t/5.0)))"

        w_expr = f"2*trunc({target_w}*{zoom_expr}/2)"
        h_expr = f"2*trunc({target_h}*{zoom_expr}/2)"
        zoom_chain = (
            f"{current_v_label}scale=w='{w_expr}':h='{h_expr}':eval=frame,"
            f"crop={target_w}:{target_h}:(in_w-{target_w})/2:(in_h-{target_h})/2[v_zoomed]"
        )
        filter_chains.append(zoom_chain)
        current_v_label = "[v_zoomed]"

    # Attach subtitles if ASS file provided (always topmost layer)
    if ass_sub_path and ass_sub_path.exists():
        escaped_sub = escape_ffmpeg_filter_path(ass_sub_path)
        sub_chain = f"{current_v_label}ass='{escaped_sub}'[v_out]"
        filter_chains.append(sub_chain)
        final_v_label = "[v_out]"
    else:
        final_v_label = current_v_label

    return ";".join(filter_chains), final_v_label


def _run_ffmpeg_deadlock_free(
    cmd: list[str],
    cancel_event: threading.Event | None = None,
    timeout: float = 180.0,
) -> tuple[int, str]:
    """
    Execute FFmpeg command redirecting stdout/stderr to a temporary log file.
    Prevents Windows subprocess pipe buffer deadlocks while supporting
    cancellation and timeout monitoring.
    """
    with tempfile.NamedTemporaryFile("w+", encoding="utf-8", delete=False, suffix=".log") as temp_log:
        temp_log_path = Path(temp_log.name)

    try:
        with open(temp_log_path, "w", encoding="utf-8", errors="replace") as out_fp:
            proc = subprocess.Popen(
                cmd,
                stdout=out_fp,
                stderr=subprocess.STDOUT,
                text=True,
            )

            start_t = time.time()
            while proc.poll() is None:
                if cancel_event and cancel_event.is_set():
                    proc.terminate()
                    try:
                        proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                    raise RuntimeError("Render job cancelled by user.")

                if time.time() - start_t > timeout:
                    proc.terminate()
                    try:
                        proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                    raise TimeoutError(f"FFmpeg render timed out after {timeout} seconds.")

                threading.Event().wait(0.2)

            returncode = proc.returncode

        try:
            log_content = temp_log_path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            log_content = ""

        return returncode, log_content

    finally:
        try:
            if temp_log_path.exists():
                temp_log_path.unlink()
        except Exception:
            pass


def render_video_clip(
    source_video_path: Path,
    output_path: Path,
    start_time: float,
    end_time: float,
    aspect_ratio: str = "9:16",
    crop_mode: str = "blur_fill",
    subtitle_style: str = "clean",
    auto_zoom: str = "subtle",
    segments: list[Any] | None = None,
    custom_transcript_json: str | None = None,
    headline_text: str | None = None,
    set_progress: Callable[[int], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> Path:
    """
    Render cropped, styled, and dynamic auto-zoomed clip using FFmpeg.
    """
    if not source_video_path.exists():
        raise FileNotFoundError(f"Source video not found: {source_video_path}")

    duration = max(0.1, end_time - start_time)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if set_progress:
        set_progress(10)

    # 1. Generate subtitle ASS file if requested
    ass_sub_file: Path | None = None
    target_w, target_h = get_target_dimensions(aspect_ratio)

    if subtitle_style != "none" and (segments or custom_transcript_json or headline_text):
        temp_ass_path = output_path.with_suffix(".ass")
        ass_sub_file = create_clip_subtitle_file(
            segments=segments or [],
            clip_start=start_time,
            clip_end=end_time,
            output_path=temp_ass_path,
            subtitle_style=subtitle_style,
            play_res_x=target_w,
            play_res_y=target_h,
            custom_transcript_json=custom_transcript_json,
            headline_text=headline_text if crop_mode == "framed_headline" else None,
        )

    if set_progress:
        set_progress(35)

    if cancel_event and cancel_event.is_set():
        raise RuntimeError("Render job cancelled before FFmpeg execution.")

    # 2. Build Filtergraph
    speaker_crop_expr: str | None = None
    if crop_mode == "speaker_track":
        try:
            from app.services.speaker_tracker import (
                detect_speaker_faces,
                build_speaker_switch_schedule,
                build_ffmpeg_crop_x_expr,
            )
            face_meta = detect_speaker_faces(source_video_path, start_time, end_time)
            schedule = build_speaker_switch_schedule(
                segments=segments or [],
                clip_start=start_time,
                clip_end=end_time,
                speaker_a_x_pct=face_meta["speaker_a_x_pct"],
                speaker_b_x_pct=face_meta["speaker_b_x_pct"],
                scaled_width=3414,
                crop_width=target_w,
                custom_transcript_json=custom_transcript_json,
            )
            speaker_crop_expr = build_ffmpeg_crop_x_expr(schedule)
        except Exception as exc:
            logger.warning(f"Error computing speaker track schedule: {exc}. Using fallback crop.")
            speaker_crop_expr = "if(mod(floor(t/4),2),2020,314)"

    filter_complex, final_v_label = build_filter_graph(
        aspect_ratio=aspect_ratio,
        crop_mode=crop_mode,
        ass_sub_path=ass_sub_file,
        auto_zoom=auto_zoom,
        clip_duration=duration,
        speaker_crop_expr=speaker_crop_expr,
    )

    # 3. Determine encoder (NVENC vs libx264)
    use_nvenc = check_nvenc_available()
    v_encoder_args = (
        ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "23"]
        if use_nvenc
        else ["-c:v", "libx264", "-preset", "fast", "-crf", "22"]
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_time:.3f}",
        "-to",
        f"{end_time:.3f}",
        "-i",
        str(source_video_path.resolve()),
        "-filter_complex",
        filter_complex,
        "-map",
        final_v_label,
        "-map",
        "0:a?",
        *v_encoder_args,
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(output_path.resolve()),
    ]

    logger.info(f"Running video render command: {' '.join(cmd)}")

    if set_progress:
        set_progress(50)

    try:
        returncode, log_output = _run_ffmpeg_deadlock_free(
            cmd,
            cancel_event=cancel_event,
            timeout=180.0,
        )

        if returncode != 0:
            logger.warning(
                f"FFmpeg render failed with code {returncode}. Log snippet:\n{log_output[-600:]}"
            )
            # If NVENC failed, try fallback to CPU libx264
            if use_nvenc:
                logger.info("Attempting automatic fallback to CPU libx264 encoding...")
                cmd_fallback = [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    f"{start_time:.3f}",
                    "-to",
                    f"{end_time:.3f}",
                    "-i",
                    str(source_video_path.resolve()),
                    "-filter_complex",
                    filter_complex,
                    "-map",
                    final_v_label,
                    "-map",
                    "0:a?",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-crf",
                    "22",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    str(output_path.resolve()),
                ]
                fb_returncode, fb_log = _run_ffmpeg_deadlock_free(
                    cmd_fallback,
                    cancel_event=cancel_event,
                    timeout=180.0,
                )
                if fb_returncode != 0:
                    raise RuntimeError(
                        f"FFmpeg CPU fallback render error (code {fb_returncode}): {fb_log[-500:]}"
                    )
            else:
                raise RuntimeError(f"FFmpeg render error (code {returncode}): {log_output[-500:]}")

    finally:
        # Clean up temporary ASS file
        if ass_sub_file and ass_sub_file.exists():
            try:
                ass_sub_file.unlink()
            except Exception:
                pass

    if set_progress:
        set_progress(95)

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError("Render completed but output file is missing or empty.")

    if set_progress:
        set_progress(100)

    logger.info(
        f"Clip render completed successfully: {output_path} ({output_path.stat().st_size} bytes)"
    )
    return output_path
