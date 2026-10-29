"""
services/video_renderer.py — Video Cropping, 9:16 Aspect Ratio Conversion,
Subtitle Burn-in, and Hardware-Accelerated Rendering Engine.

Executes FFmpeg via list array subprocess with support for:
- 9:16 Vertical (Shorts/TikTok/Reels), 1:1 Square, and 16:9 Landscape
- Layout crop modes: blur_fill, center_crop, framed_headline, speaker_track, streamer_split
- Jump-Cut Pacing auto-zoom (1.20x hard-cut per modular step function)
- Intro Hook Banner (seconds 0 to 3) & ASS subtitle burn-in
- Auto-detection of NVIDIA NVENC hardware encoder with libx264 CPU fallback
"""
from __future__ import annotations

import logging
import math
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import threading
import time
from typing import Any, Callable
import wave

from app.services.subtitle_burner import (
    create_clip_subtitle_file,
    escape_ffmpeg_filter_path,
)

logger = logging.getLogger("clipperforge.video_renderer")

_NVENC_CHECKED = False
_NVENC_AVAILABLE = False


def generate_whoosh_sfx(output_path: Path, duration: float = 0.22) -> Path:
    """
    Generate a 100% local, license-free procedural 'whoosh' audio sound effect (44.1kHz 16-bit mono WAV).
    Uses a smooth frequency sweep (180Hz -> 550Hz -> 140Hz) with a Hann amplitude envelope.
    """
    sample_rate = 44100
    num_samples = int(sample_rate * duration)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    phase1 = 0.0
    phase2 = 0.0
    samples: list[int] = []

    for i in range(num_samples):
        norm_t = i / max(1, num_samples)
        env = (math.sin(math.pi * norm_t)) ** 2
        freq1 = 180.0 + 370.0 * math.sin(math.pi * norm_t)
        freq2 = freq1 * 1.5

        phase1 += 2.0 * math.pi * freq1 / sample_rate
        phase2 += 2.0 * math.pi * freq2 / sample_rate

        val = (0.75 * math.sin(phase1) + 0.25 * math.sin(phase2)) * env
        sample_val = int(max(-32767, min(32767, val * 18000)))
        samples.append(sample_val)

    with wave.open(str(output_path.resolve()), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(struct.pack(f"<{len(samples)}h", *samples))

    return output_path


def generate_pop_sfx(output_path: Path, duration: float = 0.08) -> Path:
    """
    Generate a 100% local, license-free procedural 'pop' audio sound effect (44.1kHz 16-bit mono WAV).
    Uses a rapid downward pitch sweep (880Hz down to 220Hz) with exponential decay envelope.
    """
    sample_rate = 44100
    num_samples = int(sample_rate * duration)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    phase = 0.0
    samples: list[int] = []

    for i in range(num_samples):
        t = i / sample_rate
        norm_t = i / max(1, num_samples)
        env = math.exp(-t * 45.0)
        freq = 220.0 + 660.0 * ((1.0 - norm_t) ** 2)

        phase += 2.0 * math.pi * freq / sample_rate
        val = math.sin(phase) * env
        sample_val = int(max(-32767, min(32767, val * 22000)))
        samples.append(sample_val)

    with wave.open(str(output_path.resolve()), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(struct.pack(f"<{len(samples)}h", *samples))

    return output_path


def build_sfx_audio_track(
    output_path: Path,
    duration: float,
    switch_times: list[float] | None = None,
    pop_times: list[float] | None = None,
) -> Path | None:
    """
    Assembles a synchronized SFX audio track (.wav) with procedural whoosh transitions
    at speaker switch timestamps and pop sounds at intro card / highlight timestamps.
    Returns the path if any SFX events exist, otherwise None.
    """
    switches = [t for t in (switch_times or []) if 0.05 < t < (duration - 0.1)]
    pops = [t for t in (pop_times or []) if 0.0 <= t < duration]

    if not switches and not pops:
        return None

    sample_rate = 44100
    total_samples = int(sample_rate * duration)
    if total_samples <= 0:
        return None

    track = [0] * total_samples

    whoosh_path = output_path.parent / f"temp_whoosh_{os.getpid()}.wav"
    pop_path = output_path.parent / f"temp_pop_{os.getpid()}.wav"

    generate_whoosh_sfx(whoosh_path)
    generate_pop_sfx(pop_path)

    with wave.open(str(whoosh_path), "rb") as wf:
        n_w = wf.getnframes()
        raw_w = wf.readframes(n_w)
        whoosh_samples = list(struct.unpack(f"<{n_w}h", raw_w))

    with wave.open(str(pop_path), "rb") as wf:
        n_p = wf.getnframes()
        raw_p = wf.readframes(n_p)
        pop_samples = list(struct.unpack(f"<{n_p}h", raw_p))

    try:
        whoosh_path.unlink(missing_ok=True)
        pop_path.unlink(missing_ok=True)
    except Exception:
        pass

    # Overlay pops
    for pt in pops:
        start_idx = int(pt * sample_rate)
        for i, s in enumerate(pop_samples):
            idx = start_idx + i
            if idx < total_samples:
                track[idx] = max(-32767, min(32767, track[idx] + s))

    # Overlay whooshes (lead visual switch by 0.05s)
    for st in switches:
        start_idx = int(max(0.0, st - 0.05) * sample_rate)
        for i, s in enumerate(whoosh_samples):
            idx = start_idx + i
            if idx < total_samples:
                track[idx] = max(-32767, min(32767, track[idx] + s))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path.resolve()), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(struct.pack(f"<{len(track)}h", *track))

    return output_path


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

        # 2. Smoke test: encode 1 tiny frame to verify driver API compatibility
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
    elif aspect_ratio == "4:5":
        return 1080, 1350
    elif aspect_ratio == "16:9":
        return 1920, 1080
    # default vertical 9:16
    return 1080, 1920


def build_aspect_ratio_crop_filter(
    aspect_ratio: str = "9:16",
    crop_x_pct: float = 0.50,
) -> tuple[str, int, int]:
    """
    Generate dynamic crop & resolution filtergraph and (width, height).
    - '9:16' -> Output resolusi 1080x1920 (crop w=ih*9/16, x dihitung dari crop_x_pct).
    - '1:1'  -> Output resolusi 1080x1080 (crop w=ih, h=ih, x terpusat).
    - '4:5'  -> Output resolusi 1080x1350 (crop w=ih*4/5, h=ih).
    - '16:9' -> Output resolusi 1920x1080 (tanpa crop vertikal).
    """
    target_w, target_h = get_target_dimensions(aspect_ratio)
    clamped_x = max(0.0, min(1.0, float(crop_x_pct)))

    if aspect_ratio == "9:16":
        x_expr = f"(iw-ow)*{clamped_x:.4f}" if clamped_x != 0.5 else "(iw-ow)/2"
        filt = f"crop=w='ih*9/16':h='ih':x='{x_expr}':y=0,scale=1080:1920"
    elif aspect_ratio == "1:1":
        filt = "crop=w='ih':h='ih':x='(iw-ow)/2':y=0,scale=1080:1080"
    elif aspect_ratio == "4:5":
        x_expr = f"(iw-ow)*{clamped_x:.4f}" if clamped_x != 0.5 else "(iw-ow)/2"
        filt = f"crop=w='ih*4/5':h='ih':x='{x_expr}':y=0,scale=1080:1350"
    elif aspect_ratio == "16:9":
        filt = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2"
    else:
        x_expr = f"(iw-ow)*{clamped_x:.4f}" if clamped_x != 0.5 else "(iw-ow)/2"
        filt = f"crop=w='ih*9/16':h='ih':x='{x_expr}':y=0,scale=1080:1920"

    return filt, target_w, target_h


def parse_silencedetect_output(
    log_text: str,
    clip_duration: float,
    min_silence_duration: float = 0.5,
) -> list[tuple[float, float]]:
    """
    Parse FFmpeg silencedetect output and return list of (silence_start, silence_end)
    intervals that exceed min_silence_duration (default 0.5s), clamped to [0.0, clip_duration].
    """
    import re
    silence_starts: list[float] = []
    silent_intervals: list[tuple[float, float]] = []

    for line in log_text.splitlines():
        m_start = re.search(r"silence_start:\s*([0-9.]+)", line)
        if m_start:
            silence_starts.append(float(m_start.group(1)))

        m_end = re.search(r"silence_end:\s*([0-9.]+)", line)
        if m_end and silence_starts:
            s_start = silence_starts.pop(0)
            s_end = float(m_end.group(1))
            if (s_end - s_start) >= min_silence_duration:
                clamped_start = max(0.0, min(clip_duration, s_start))
                clamped_end = max(0.0, min(clip_duration, s_end))
                if clamped_end > clamped_start:
                    silent_intervals.append((round(clamped_start, 3), round(clamped_end, 3)))

    return silent_intervals


def compute_audible_segments(
    silent_intervals: list[tuple[float, float]],
    clip_duration: float,
    padding: float = 0.05,
) -> list[tuple[float, float]]:
    """
    Compute non-silent (audible) time segments to keep by cutting out silent intervals.
    Includes smooth padding (50ms) around speech boundaries so syllables are never clipped.
    """
    if not silent_intervals:
        return [(0.0, round(clip_duration, 3))]

    sorted_intervals = sorted(silent_intervals, key=lambda x: x[0])
    audible: list[tuple[float, float]] = []
    curr = 0.0

    for s_start, s_end in sorted_intervals:
        seg_start = max(0.0, curr)
        seg_end = min(clip_duration, s_start + padding)
        if seg_end - seg_start >= 0.1:
            audible.append((round(seg_start, 3), round(seg_end, 3)))
        curr = max(curr, s_end - padding)

    if clip_duration - curr >= 0.1:
        audible.append((round(curr, 3), round(clip_duration, 3)))

    if not audible:
        return [(0.0, round(clip_duration, 3))]

    return audible


def detect_silence_segments(
    source_video_path: Path,
    start_time: float,
    end_time: float,
    noise_db: str = "-30dB",
    min_silence_duration: float = 0.5,
) -> list[tuple[float, float]]:
    """
    Detect silent segments in a video clip using FFmpeg silencedetect=n=-30dB:d=0.5.
    Returns list of (start, end) silent timestamps relative to start_time.
    """
    duration = max(0.1, end_time - start_time)
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-ss",
        f"{start_time:.3f}",
        "-to",
        f"{end_time:.3f}",
        "-i",
        str(source_video_path.resolve()),
        "-af",
        f"silencedetect=n={noise_db}:d={min_silence_duration}",
        "-vn",
        "-f",
        "null",
        "-",
    ]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30.0,
            check=False,
        )
        output_log = (proc.stderr or "") + "\n" + (proc.stdout or "")
        return parse_silencedetect_output(output_log, duration, min_silence_duration)
    except Exception as exc:
        logger.warning(f"Error during silence detection: {exc}. Proceeding without silence removal.")
        return []


def remove_silence_from_video(
    source_video_path: Path,
    output_path: Path,
    start_time: float,
    end_time: float,
    noise_db: str = "-30dB",
    min_silence_duration: float = 0.5,
    return_segments: bool = False,
) -> Path | tuple[Path, list[tuple[float, float]]]:
    """
    Cuts out dead silence (> 0.5s) from source video window using FFmpeg jump-cuts.
    If no silence is found or error occurs, extracts standard trimmed clip.
    If return_segments=True, returns (output_path, audible_segments).
    """
    duration = max(0.1, end_time - start_time)
    silent_intervals = detect_silence_segments(
        source_video_path=source_video_path,
        start_time=start_time,
        end_time=end_time,
        noise_db=noise_db,
        min_silence_duration=min_silence_duration,
    )
    audible_segments = compute_audible_segments(silent_intervals, duration)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    if len(audible_segments) <= 1:
        cmd = [
            "ffmpeg",
            "-y",
            "-ss",
            f"{start_time:.3f}",
            "-to",
            f"{end_time:.3f}",
            "-i",
            str(source_video_path.resolve()),
            "-c",
            "copy",
            str(output_path.resolve()),
        ]
    else:
        select_expr = "+".join(
            f"between(t,{s:.3f},{e:.3f})" for s, e in audible_segments
        )
        filter_str = (
            f"[0:v]select='{select_expr}',setpts=N/FRAME_RATE/TB[v];"
            f"[0:a]aselect='{select_expr}',asetpts=N/SR/TB[a]"
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
            filter_str,
            "-map",
            "[v]",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(output_path.resolve()),
        ]

    try:
        ret, log_out = _run_ffmpeg_deadlock_free(cmd, timeout=90.0)
        if ret != 0 or not output_path.exists() or output_path.stat().st_size == 0:
            logger.warning(f"Silence removal FFmpeg execution failed ({ret}): {log_out[-400:]}")
            cmd_fb = [
                "ffmpeg",
                "-y",
                "-ss",
                f"{start_time:.3f}",
                "-to",
                f"{end_time:.3f}",
                "-i",
                str(source_video_path.resolve()),
                "-c",
                "copy",
                str(output_path.resolve()),
            ]
            _run_ffmpeg_deadlock_free(cmd_fb, timeout=60.0)
            audible_segments = [(0.0, round(duration, 3))]
    except Exception as exc:
        logger.warning(f"Error in remove_silence_from_video: {exc}")
        audible_segments = [(0.0, round(duration, 3))]

    if return_segments:
        return output_path, audible_segments
    return output_path


def build_filter_graph(
    aspect_ratio: str = "9:16",
    crop_mode: str = "blur_fill",
    ass_sub_path: Path | None = None,
    auto_zoom: str = "none",
    clip_duration: float = 30.0,
    speaker_crop_expr: str | None = None,
    facecam_crop_params: dict[str, Any] | None = None,
    crop_x_pct: float = 0.50,
) -> tuple[str, str]:
    """
    Build FFmpeg -filter_complex string and the final video output label.
    Supports layout cropping presets, Jump-Cut Pacing auto-zoom,
    active speaker tracking switching, streamer split (facecam top + gameplay bottom),
    aspect ratio variations (9:16, 1:1, 4:5, 16:9), and ASS subtitle burn-in.
    Returns: (filter_complex_str, final_v_label)
    """
    target_w, target_h = get_target_dimensions(aspect_ratio)

    filter_chains: list[str] = []

    if crop_mode in ("center_crop", "reframe", "manual_reframe"):
        # Dynamic Aspect Ratio & Reframe Crop (9:16, 1:1, 4:5, 16:9)
        crop_label = "[v_cropped]" if auto_zoom == "none" else "[v_base]"
        clamped_x = max(0.0, min(1.0, float(crop_x_pct)))
        if aspect_ratio == "16:9":
            crop_chain = (
                f"[0:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
                f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:black{crop_label}"
            )
        else:
            x_calc = f"(in_w-{target_w})*{clamped_x:.4f}" if clamped_x != 0.5 else f"(in_w-{target_w})/2"
            crop_chain = (
                f"[0:v]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{target_h}:{x_calc}:(in_h-{target_h})/2{crop_label}"
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

    elif crop_mode in ("speaker_track", "active_speaker", "single_speaker"):
        # Active Speaker Tracking — Medium Shot (proportional head-to-chest framing, no tight crop).
        # Scale source video so height fills target_h (3414x1920 native 16:9 scale).
        # Y crop: headroom of minimal 18% from top so forehead/hair is never cramped.
        # X crop: driven by speaker_crop_expr for true centering per speaker.
        speaker_label = "[v_speaker_track]" if auto_zoom == "none" else "[v_base]"
        crop_x = speaker_crop_expr or "if(mod(floor(t/4),2),2020,314)"
        # Scale so native height exactly equals target_h; width scales proportionally (3414 for 1920h).
        scale_w = 3414
        scale_h = target_h  # 1.0x — full height, no tight digital punch-in
        # Y position: 18% headroom from top
        y_crop = f"'max(0,in_h-{target_h})*0.18'"
        crop_chain = (
            f"[0:v]scale={scale_w}:{scale_h}:force_original_aspect_ratio=increase,"
            f"crop={target_w}:{target_h}:x='{crop_x}':y={y_crop}{speaker_label}"
        )
        filter_chains.append(crop_chain)
        current_v_label = speaker_label

    elif crop_mode in ("split_screen", "streamer_split"):
        default_lbl = "[v_streamer_split]" if crop_mode == "streamer_split" else "[v_split_stack]"
        split_label = default_lbl if auto_zoom == "none" else "[v_base]"
        half_h = target_h // 2

        if crop_mode == "split_screen":
            # Dual stacked podcast split: Top Speaker A (1080x960), Bottom Speaker B (1080x960)
            top_x = float((facecam_crop_params or {}).get("top_speaker_x", 0.25))
            bot_x = float((facecam_crop_params or {}).get("bottom_speaker_x", 0.75))
            top_y = float((facecam_crop_params or {}).get("top_speaker_y", 0.35))
            bot_y = float((facecam_crop_params or {}).get("bottom_speaker_y", 0.35))

            top_x_expr = f"min(max(0,in_w*{top_x:.3f}-in_w*0.25),in_w-in_w*0.50)"
            bot_x_expr = f"min(max(0,in_w*{bot_x:.3f}-in_w*0.25),in_w-in_w*0.50)"
            top_y_expr = f"min(max(0,in_h*{top_y:.3f}-in_h*0.25),in_h-in_h*0.50)"
            bot_y_expr = f"min(max(0,in_h*{bot_y:.3f}-in_h*0.25),in_h-in_h*0.50)"

            split_chain = (
                f"[0:v]split=2[v_top_raw][v_bot_raw];"
                f"[v_top_raw]crop=w=in_w*0.50:h=in_w*0.50*({half_h}/{target_w}):x='{top_x_expr}':y='{top_y_expr}',"
                f"scale={target_w}:{half_h}[v_top];"
                f"[v_bot_raw]crop=w=in_w*0.50:h=in_w*0.50*({half_h}/{target_w}):x='{bot_x_expr}':y='{bot_y_expr}',"
                f"scale={target_w}:{half_h}[v_bot];"
                f"[v_top][v_bot]vstack=inputs=2{split_label}"
            )
            filter_chains.append(split_chain)
            current_v_label = split_label
        else:
            # Streamer Split: Facecam top (1080x960), Gameplay bottom (1080x960) stacked vertically
            fx = (facecam_crop_params or {}).get("face_x_pct", 0.85)
            fy = (facecam_crop_params or {}).get("face_y_pct", 0.75)

            cam_x_expr = f"min(max(0,in_w*{fx:.3f}-in_w*0.21),in_w-in_w*0.42)"
            cam_y_expr = f"min(max(0,in_h*{fy:.3f}-(in_w*0.42*({half_h}/{target_w}))/2),in_h-in_w*0.42*({half_h}/{target_w}))"

            split_chain = (
                f"[0:v]split=2[v_cam_src][v_game_src];"
                f"[v_cam_src]crop=w=in_w*0.42:h=in_w*0.42*({half_h}/{target_w}):x='{cam_x_expr}':y='{cam_y_expr}',"
                f"scale={target_w}:{half_h}[v_cam_top];"
                f"[v_game_src]scale={target_w}:{half_h}:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{half_h}:(in_w-{target_w})/2:(in_h-{half_h})/2[v_game_bot];"
                f"[v_cam_top][v_game_bot]vstack=inputs=2{split_label}"
            )
            filter_chains.append(split_chain)
            current_v_label = split_label

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

    # Apply Jump-Cut Pacing ala konten FYP:
    # Kamera stabil di 1.00x, melompat instan (hard-cut) ke 1.20x selama 2 detik setiap jeda 5 detik
    if auto_zoom in ("subtle", "jump_cut", "snap_hook", "punchy"):
        if auto_zoom == "snap_hook":
            # Jump-cut 1.20x zoom during first 3 seconds hook, then snap back to 1.0x
            zoom_expr = "if(lte(t,3),1.20,1.00)"
        elif auto_zoom == "punchy":
            # Hard-cut punchy: 1.25x for 1.5s every 4s
            zoom_expr = "if(lt(mod(t, 4), 1.5), 1.25, 1.00)"
        else:
            # Jump-Cut Pacing: if(lt(mod(t, 5), 2.0), 1.20, 1.00)
            zoom_expr = "if(lt(mod(t, 5), 2.0), 1.20, 1.00)"

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
    Run FFmpeg avoiding pipe deadlock by redirecting stdout/stderr into a temporary file.
    Cooperatively checks cancel_event to terminate the child process immediately.
    """
    with tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".log") as tmp_log:
        tmp_log_path = Path(tmp_log.name)

    try:
        with open(tmp_log_path, "wb") as log_file:
            process = subprocess.Popen(
                cmd,
                stdout=log_file,
                stderr=subprocess.STDOUT,
            )

            start_t = time.time()
            while process.poll() is None:
                if cancel_event and cancel_event.is_set():
                    logger.warning("Render cancellation requested. Killing FFmpeg process.")
                    process.terminate()
                    try:
                        process.wait(timeout=3.0)
                    except subprocess.TimeoutExpired:
                        process.kill()
                    raise RuntimeError("Render job cancelled by user.")

                if time.time() - start_t > timeout:
                    process.kill()
                    raise TimeoutError(f"FFmpeg render process exceeded timeout of {timeout}s.")

                time.sleep(0.1)

            ret_code = process.returncode

        log_content = tmp_log_path.read_text(encoding="utf-8", errors="replace")
        return ret_code, log_content
    finally:
        try:
            tmp_log_path.unlink(missing_ok=True)
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
    intro_hook_banner: bool = True,
    enable_sfx: bool = True,
    framing_offset_pct: float = 0.0,
    crop_x_pct: float = 0.50,
    remove_silence: bool = False,
    auto_emoji: bool = True,
    bgm_track_id: str | None = None,
    bgm_volume: float = 0.18,
    soundboard_cues: list[dict[str, Any]] | None = None,
    set_progress: Callable[[int], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> Path:
    """
    Render cropped, styled, and jump-cut zoomed clip using FFmpeg.
    Supports dynamic aspect ratio, horizontal reframe crop_x_pct,
    smart silence removal (jump-cut), and auto-emoji subtitles.
    """
    if not source_video_path.exists():
        raise FileNotFoundError(f"Source video not found: {source_video_path}")

    duration = max(0.1, end_time - start_time)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if set_progress:
        set_progress(10)

    # 0. Smart Silence Removal (Jump-Cut) pre-process if requested
    actual_source_path = source_video_path
    actual_start_time = start_time
    actual_end_time = end_time
    effective_clip_start = start_time
    effective_clip_end = end_time
    effective_segments = segments or []
    effective_custom_transcript_json = custom_transcript_json
    audible_segments: list[tuple[float, float]] = []
    temp_silence_file: Path | None = None

    if remove_silence:
        try:
            temp_silence_file = output_path.with_suffix(".nosilence.mp4")
            _, audible_segments = remove_silence_from_video(
                source_video_path=source_video_path,
                output_path=temp_silence_file,
                start_time=start_time,
                end_time=end_time,
                noise_db="-30dB",
                min_silence_duration=0.5,
                return_segments=True,
            )
            if temp_silence_file.exists() and temp_silence_file.stat().st_size > 0:
                actual_source_path = temp_silence_file
                try:
                    from app.services.media_probe import probe
                    meta = probe(temp_silence_file)
                    new_dur = float(meta.get("duration") or (end_time - start_time))
                except Exception:
                    new_dur = duration
                actual_start_time = 0.0
                actual_end_time = new_dur
                duration = new_dur
                effective_clip_start = 0.0
                effective_clip_end = new_dur

                if len(audible_segments) > 1:
                    from app.services.subtitle_burner import remap_segments_for_silence
                    effective_segments = remap_segments_for_silence(
                        segments or [], start_time, audible_segments
                    )
                    if custom_transcript_json:
                        try:
                            parsed_ct = json.loads(custom_transcript_json)
                            if isinstance(parsed_ct, list) and parsed_ct:
                                remapped_ct = remap_segments_for_silence(
                                    parsed_ct, start_time, audible_segments
                                )
                                effective_custom_transcript_json = json.dumps(remapped_ct)
                        except Exception:
                            pass
        except Exception as exc:
            logger.warning(f"Silence removal pre-process failed: {exc}. Continuing with original clip.")

    # 1. Generate subtitle ASS file if requested
    ass_sub_file: Path | None = None
    target_w, target_h = get_target_dimensions(aspect_ratio)

    if subtitle_style != "none" and (effective_segments or effective_custom_transcript_json or headline_text):
        temp_ass_path = output_path.with_suffix(".ass")
        ass_sub_file = create_clip_subtitle_file(
            segments=effective_segments,
            clip_start=effective_clip_start,
            clip_end=effective_clip_end,
            output_path=temp_ass_path,
            subtitle_style=subtitle_style,
            play_res_x=target_w,
            play_res_y=target_h,
            custom_transcript_json=effective_custom_transcript_json,
            headline_text=headline_text if (intro_hook_banner or crop_mode in ("framed_headline", "streamer_split")) else None,
            is_streamer_split=(crop_mode == "streamer_split"),
            intro_hook_banner=intro_hook_banner,
            auto_emoji=auto_emoji,
        )

    if set_progress:
        set_progress(35)

    if cancel_event and cancel_event.is_set():
        raise RuntimeError("Render job cancelled before FFmpeg execution.")

    # 2. Build Filtergraph
    speaker_crop_expr: str | None = None
    facecam_crop_params: dict[str, Any] | None = None
    switch_times: list[float] = []

    if crop_mode in ("single_speaker", "active_speaker", "speaker_track", "split_screen"):
        try:
            from app.services.speaker_tracker import track_active_speakers
            tracker_mode = "split_screen" if crop_mode == "split_screen" else ("single_speaker" if crop_mode == "single_speaker" else "active_speaker")
            tracking_res = track_active_speakers(
                video_path=actual_source_path,
                start_time=actual_start_time,
                end_time=actual_end_time,
                mode=tracker_mode,
                target_width=target_w,
                target_height=target_h,
                scaled_width=3414,
                manual_crop_x_pct=crop_x_pct,
                segments=effective_segments,
            )
            speaker_crop_expr = tracking_res.crop_expr
            if tracker_mode == "split_screen" and tracking_res.split_params:
                facecam_crop_params = tracking_res.split_params
            if tracking_res.shot_cuts:
                for sc in tracking_res.shot_cuts:
                    rel_sc = sc - actual_start_time
                    if 0.1 < rel_sc < (duration - 0.1):
                        switch_times.append(rel_sc)
        except Exception as exc:
            logger.warning(f"Error computing speaker track schedule: {exc}. Using fallback crop.")
            speaker_crop_expr = "if(mod(floor(t/4),2),2020,314)"

    elif crop_mode == "streamer_split":
        try:
            from app.services.speaker_tracker import detect_streamer_facecam
            facecam_meta = detect_streamer_facecam(source_video_path, start_time, end_time)
            facecam_crop_params = facecam_meta
        except Exception as exc:
            logger.warning(f"Error detecting streamer facecam: {exc}. Using fallback coordinates.")
            facecam_crop_params = {
                "detected": False,
                "face_x_pct": 0.85,
                "face_y_pct": 0.75,
                "corner": "bottom_right",
            }

    filter_complex, final_v_label = build_filter_graph(
        aspect_ratio=aspect_ratio,
        crop_mode=crop_mode,
        ass_sub_path=ass_sub_file,
        auto_zoom=auto_zoom,
        clip_duration=duration,
        speaker_crop_expr=speaker_crop_expr,
        facecam_crop_params=facecam_crop_params,
        crop_x_pct=crop_x_pct,
    )

    # 3. Audio Polish, Background Music (BGM) & Speech Auto-Ducking Engine
    bgm_file: Path | None = None
    if bgm_track_id and bgm_track_id.strip() and bgm_track_id.strip().lower() != "none":
        try:
            from app.services.music_service import get_music_track_path
            bgm_file = get_music_track_path(bgm_track_id.strip())
        except Exception as bgm_exc:
            logger.warning(f"Failed to resolve BGM track '{bgm_track_id}': {bgm_exc}")
            bgm_file = None

    sfx_wav_file: Path | None = None
    pop_times: list[float] = []
    if intro_hook_banner and headline_text:
        pop_times.append(0.08)

    if enable_sfx and (switch_times or pop_times):
        try:
            temp_sfx_path = output_path.with_suffix(".sfx.wav")
            sfx_wav_file = build_sfx_audio_track(
                output_path=temp_sfx_path,
                duration=duration,
                switch_times=switch_times,
                pop_times=pop_times,
            )
        except Exception as sfx_exc:
            logger.warning(f"Failed to generate audio SFX track: {sfx_exc}")
            sfx_wav_file = None

    # Resolve soundboard cues
    valid_sb_cues: list[tuple[Path, float, float]] = []
    if soundboard_cues:
        try:
            from app.services.soundboard_service import get_sound_file_path
            for cue in soundboard_cues:
                s_id = cue.get("sound_id")
                if not s_id:
                    continue
                s_file = get_sound_file_path(str(s_id))
                if s_file and s_file.exists():
                    raw_ts = float(cue.get("timestamp", 0.0) or 0.0)
                    if start_time <= raw_ts <= end_time:
                        rel_ts = raw_ts - start_time
                    elif 0.0 <= raw_ts <= duration:
                        rel_ts = raw_ts
                    else:
                        rel_ts = max(0.0, raw_ts)
                    if remove_silence and len(audible_segments) > 1:
                        from app.services.subtitle_burner import remap_timestamp_for_silence
                        rel_ts = remap_timestamp_for_silence(rel_ts, audible_segments)
                    vol = max(0.0, min(2.0, float(cue.get("volume", 0.90) or 0.90)))
                    valid_sb_cues.append((s_file, rel_ts, vol))
        except Exception as sb_exc:
            logger.warning(f"Failed to resolve soundboard cues: {sb_exc}")

    extra_input_args: list[str] = []
    curr_input_idx = 1
    bgm_input_idx: int | None = None
    sfx_input_idx: int | None = None
    sb_input_indices: list[int] = []

    if bgm_file and bgm_file.exists():
        extra_input_args.extend(["-stream_loop", "-1", "-i", str(bgm_file.resolve())])
        bgm_input_idx = curr_input_idx
        curr_input_idx += 1

    if sfx_wav_file and sfx_wav_file.exists():
        extra_input_args.extend(["-i", str(sfx_wav_file.resolve())])
        sfx_input_idx = curr_input_idx
        curr_input_idx += 1

    for s_file, _, _ in valid_sb_cues:
        extra_input_args.extend(["-i", str(s_file.resolve())])
        sb_input_indices.append(curr_input_idx)
        curr_input_idx += 1

    # Check whether source video contains an audio stream
    has_source_audio = True
    try:
        from app.services.media_probe import probe
        v_meta = probe(source_video_path)
        if v_meta.get("audio_channels") is None or (v_meta.get("audio_channels") or 0) <= 0:
            has_source_audio = False
    except Exception:
        pass

    safe_bgm_vol = max(0.02, min(1.0, float(bgm_volume if bgm_volume is not None else 0.18)))

    audio_filters: list[str] = []
    sb_stream_labels: list[str] = []

    # Build adelay filters for each soundboard cue (precision in milliseconds)
    for i, ((_, rel_ts, vol), inp_idx) in enumerate(zip(valid_sb_cues, sb_input_indices)):
        delay_ms = max(0, int(round(rel_ts * 1000)))
        lbl = f"sb_{i}"
        audio_filters.append(
            f"[{inp_idx}:a]aformat=channel_layouts=stereo:sample_rates=44100,volume={vol:.2f},adelay={delay_ms}|{delay_ms}[{lbl}]"
        )
        sb_stream_labels.append(f"[{lbl}]")

    # If soundboard cues are present, mix them with vocal and optional BGM/SFX
    if sb_stream_labels:
        mix_inputs: list[str] = []
        if has_source_audio:
            if bgm_input_idx is not None:
                audio_filters.append("[0:a]aformat=channel_layouts=stereo:sample_rates=44100,asplit=2[vocal_main][vocal_sc]")
                audio_filters.append(f"[{bgm_input_idx}:a]aformat=channel_layouts=stereo:sample_rates=44100,volume={safe_bgm_vol:.2f}[bgm_vol]")
                audio_filters.append("[bgm_vol][vocal_sc]sidechaincompress=threshold=0.10:ratio=8:attack=15:release=450:makeup=1[ducked_bgm]")
                mix_inputs.extend(["[vocal_main]", "[ducked_bgm]"])
            else:
                audio_filters.append("[0:a]aformat=channel_layouts=stereo:sample_rates=44100[vocal_main]")
                mix_inputs.append("[vocal_main]")
        else:
            if bgm_input_idx is not None:
                audio_filters.append(f"[{bgm_input_idx}:a]aformat=channel_layouts=stereo:sample_rates=44100,volume={safe_bgm_vol:.2f}[bgm_vol]")
                mix_inputs.append("[bgm_vol]")
            else:
                audio_filters.append(f"aevalsrc=0:d={duration}[vocal_main]")
                mix_inputs.append("[vocal_main]")

        if sfx_input_idx is not None:
            audio_filters.append(f"[{sfx_input_idx}:a]aformat=channel_layouts=stereo:sample_rates=44100[sfx_fmt]")
            mix_inputs.append("[sfx_fmt]")

        mix_inputs.extend(sb_stream_labels)
        audio_filters.append(f"{''.join(mix_inputs)}amix=inputs={len(mix_inputs)}:duration=first:dropout_transition=0[a_out]")
        audio_map_args = ["-map", "[a_out]"]

    elif bgm_input_idx is not None and has_source_audio:
        # Complex speech auto-ducking via sidechaincompress:
        # Music volume drops by ~20dB when speech is detected (threshold=0.10, ratio=8, attack=15ms, release=450ms)
        audio_filters.append("[0:a]aformat=channel_layouts=stereo:sample_rates=44100,asplit=2[vocal_main][vocal_sc]")
        audio_filters.append(f"[{bgm_input_idx}:a]aformat=channel_layouts=stereo:sample_rates=44100,volume={safe_bgm_vol:.2f}[bgm_vol]")
        audio_filters.append("[bgm_vol][vocal_sc]sidechaincompress=threshold=0.10:ratio=8:attack=15:release=450:makeup=1[ducked_bgm]")
        if sfx_input_idx is not None:
            audio_filters.append(f"[{sfx_input_idx}:a]aformat=channel_layouts=stereo:sample_rates=44100[sfx_fmt]")
            audio_filters.append("[vocal_main][ducked_bgm][sfx_fmt]amix=inputs=3:duration=first:dropout_transition=0:weights=1.0 1.0 0.85[a_out]")
        else:
            audio_filters.append("[vocal_main][ducked_bgm]amix=inputs=2:duration=first:dropout_transition=0:weights=1.0 1.0[a_out]")
        audio_map_args = ["-map", "[a_out]"]

    elif bgm_input_idx is not None and not has_source_audio:
        # Source video has no audio track, output BGM directly (+ SFX if present)
        audio_filters.append(f"[{bgm_input_idx}:a]aformat=channel_layouts=stereo:sample_rates=44100,volume={safe_bgm_vol:.2f}[bgm_vol]")
        if sfx_input_idx is not None:
            audio_filters.append(f"[{sfx_input_idx}:a]aformat=channel_layouts=stereo:sample_rates=44100[sfx_fmt]")
            audio_filters.append("[bgm_vol][sfx_fmt]amix=inputs=2:duration=first:dropout_transition=0:weights=1.0 0.85[a_out]")
        else:
            audio_filters.append("[bgm_vol]anull[a_out]")
        audio_map_args = ["-map", "[a_out]"]

    elif sfx_input_idx is not None:
        # No BGM, only SFX mixed with source audio
        audio_filters.append(f"[0:a][{sfx_input_idx}:a]amix=inputs=2:duration=first:dropout_transition=0:weights=1.0 0.85[a_out]")
        audio_map_args = ["-map", "[a_out]"]
    else:
        # Standard source audio
        audio_map_args = ["-map", "0:a?"]

    if audio_filters:
        audio_chain = ";".join(audio_filters)
        filter_complex_with_audio = f"{filter_complex};{audio_chain}"
    else:
        filter_complex_with_audio = filter_complex

    # 4. Determine encoder (NVENC vs libx264)
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
        f"{actual_start_time:.3f}",
        "-to",
        f"{actual_end_time:.3f}",
        "-i",
        str(actual_source_path.resolve()),
        *extra_input_args,
        "-filter_complex",
        filter_complex_with_audio,
        "-map",
        final_v_label,
        *audio_map_args,
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
                    f"{actual_start_time:.3f}",
                    "-to",
                    f"{actual_end_time:.3f}",
                    "-i",
                    str(actual_source_path.resolve()),
                    *extra_input_args,
                    "-filter_complex",
                    filter_complex_with_audio,
                    "-map",
                    final_v_label,
                    *audio_map_args,
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
        # Clean up temporary SFX file
        if sfx_wav_file and sfx_wav_file.exists():
            try:
                sfx_wav_file.unlink()
            except Exception:
                pass
        # Clean up temporary silence removal file
        if temp_silence_file and temp_silence_file.exists():
            try:
                temp_silence_file.unlink()
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
