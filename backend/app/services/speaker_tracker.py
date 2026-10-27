"""
services/speaker_tracker.py — Active Speaker Tracking & Dynamic Speaker Switching Engine.

Provides:
- detect_speaker_faces(): Detects horizontal face locations (left, center, right)
  using OpenCV Haar Cascade classifiers across video sample frames (100% local, no API fees).
- build_speaker_switch_schedule(): Generates timeline of active speaker intervals
  mapped from Whisper/custom subtitle segments and speech dialogue turns.
- build_ffmpeg_crop_x_expr(): Converts speaker schedule into an FFmpeg conditional
  crop X expression for automated camera switching in 9:16 vertical video.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def detect_speaker_faces(
    video_path: Path | str,
    start_time: float,
    end_time: float,
    num_samples: int = 8,
) -> dict[str, Any]:
    """
    Scans sample frames of a video clip to detect horizontal face locations
    (Speaker A on the left, Speaker B on the right).
    Returns coordinates as percentages (0.0 to 1.0) of frame width.
    """
    default_res = {
        "detected": False,
        "speaker_a_x_pct": 0.25,
        "speaker_b_x_pct": 0.75,
        "speakers": {
            "Speaker A": 0.25,
            "Speaker B": 0.75,
        },
    }

    v_path = Path(video_path)
    if not v_path.exists():
        logger.warning(f"Video file not found for face detection: {video_path}")
        return default_res

    duration = max(0.5, end_time - start_time)

    try:
        import cv2
    except ImportError:
        logger.warning("OpenCV not installed. Using default speaker coordinates.")
        return default_res

    try:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        face_cascade = cv2.CascadeClassifier(cascade_path)
        if face_cascade.empty():
            logger.warning("Failed to load haarcascade_frontalface_default.xml.")
            return default_res

        cap = cv2.VideoCapture(str(v_path.resolve()))
        if not cap.isOpened():
            logger.warning(f"Failed to open video capture for: {v_path}")
            return default_res

        left_centers: list[float] = []
        right_centers: list[float] = []

        step = duration / (num_samples + 1)
        sample_times = [start_time + step * (i + 1) for i in range(num_samples)]

        for t in sample_times:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
            ret, frame = cap.read()
            if not ret or frame is None:
                continue

            h, w = frame.shape[:2]
            if w <= 0 or h <= 0:
                continue

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            scale = 1.0
            if w > 1280:
                scale = 1280.0 / w
                small_w = int(w * scale)
                small_h = int(h * scale)
                gray = cv2.resize(gray, (small_w, small_h), interpolation=cv2.INTER_LINEAR)
            else:
                small_w, small_h = w, h

            faces = face_cascade.detectMultiScale(
                gray,
                scaleFactor=1.15,
                minNeighbors=4,
                minSize=(int(small_h * 0.08), int(small_h * 0.08)),
            )

            for fx, _fy, fw, _fh in faces:
                center_x_norm = (fx + fw / 2.0) / small_w
                if center_x_norm < 0.48:
                    left_centers.append(center_x_norm)
                elif center_x_norm > 0.52:
                    right_centers.append(center_x_norm)

        cap.release()

        speaker_a_pct = 0.25
        speaker_b_pct = 0.75
        detected = False

        if left_centers:
            left_centers.sort()
            speaker_a_pct = max(0.12, min(0.42, left_centers[len(left_centers) // 2]))
            detected = True

        if right_centers:
            right_centers.sort()
            speaker_b_pct = max(0.58, min(0.88, right_centers[len(right_centers) // 2]))
            detected = True

        return {
            "detected": detected,
            "speaker_a_x_pct": round(speaker_a_pct, 3),
            "speaker_b_x_pct": round(speaker_b_pct, 3),
            "speakers": {
                "Speaker A": round(speaker_a_pct, 3),
                "Speaker B": round(speaker_b_pct, 3),
            },
        }

    except Exception as exc:
        logger.warning(f"Error during face tracking scan: {exc}")
        return default_res


def build_speaker_switch_schedule(
    segments: list[dict[str, Any]],
    clip_start: float,
    clip_end: float,
    speaker_a_x_pct: float = 0.25,
    speaker_b_x_pct: float = 0.75,
    scaled_width: int = 3414,
    crop_width: int = 1080,
    custom_transcript_json: str | None = None,
) -> list[dict[str, Any]]:
    """
    Builds a timeline schedule of speaker intervals [start, end, speaker, x_pct, x_pixel]
    relative to clip_start (0.0 to clip_duration).
    """
    duration = max(0.1, round(clip_end - clip_start, 2))
    max_x = max(0, scaled_width - crop_width)

    # Pixel X positions centered on speaker face in scaled coordinate space
    x_speaker_a = int(max(0, min(max_x, round(scaled_width * speaker_a_x_pct - crop_width / 2))))
    x_speaker_b = int(max(0, min(max_x, round(scaled_width * speaker_b_x_pct - crop_width / 2))))

    # Resolve active segments
    active_segments: list[dict[str, Any]] = []
    if custom_transcript_json:
        try:
            parsed = json.loads(custom_transcript_json)
            if isinstance(parsed, list) and parsed:
                active_segments = parsed
        except Exception:
            pass

    if not active_segments and segments:
        for s in segments:
            s_st = float(s.get("start_time", 0.0))
            s_et = float(s.get("end_time", 0.0))
            if s_et > clip_start and s_st < clip_end:
                active_segments.append(s)

    if not active_segments:
        return [
            {
                "start": 0.0,
                "end": duration,
                "speaker": "Speaker A",
                "x_pct": speaker_a_x_pct,
                "x": x_speaker_a,
            }
        ]

    # Assign speaker to each segment:
    # 1. Respect explicit 'speaker_label' or 'speaker' if set
    # 2. Otherwise alternate speaker turns based on dialogue pauses (> 0.5s) or alternating turns
    labeled_segs: list[dict[str, Any]] = []
    current_auto_speaker = "Speaker A"

    for i, seg in enumerate(active_segments):
        st = max(0.0, float(seg.get("start_time", 0.0)) - clip_start)
        et = min(duration, float(seg.get("end_time", 0.0)) - clip_start)
        if et <= st:
            continue

        label = seg.get("speaker_label") or seg.get("speaker")
        if label:
            label_lower = str(label).lower()
            if any(k in label_lower for k in ["b", "2", "kanan", "right", "guest", "tamu", "second"]):
                spk = "Speaker B"
            else:
                spk = "Speaker A"
        else:
            if i > 0:
                prev_et = max(0.0, float(active_segments[i - 1].get("end_time", 0.0)) - clip_start)
                pause = st - prev_et
                if pause >= 0.5:
                    current_auto_speaker = "Speaker B" if current_auto_speaker == "Speaker A" else "Speaker A"
                elif i % 2 == 1:
                    current_auto_speaker = "Speaker B" if current_auto_speaker == "Speaker A" else "Speaker A"
            spk = current_auto_speaker

        x_pct = speaker_b_x_pct if spk == "Speaker B" else speaker_a_x_pct
        x_px = x_speaker_b if spk == "Speaker B" else x_speaker_a

        labeled_segs.append({
            "start": round(st, 2),
            "end": round(et, 2),
            "speaker": spk,
            "x_pct": x_pct,
            "x": x_px,
        })

    if not labeled_segs:
        return [
            {
                "start": 0.0,
                "end": duration,
                "speaker": "Speaker A",
                "x_pct": speaker_a_x_pct,
                "x": x_speaker_a,
            }
        ]

    # Create continuous schedule spanning from 0.0 to duration
    schedule: list[dict[str, Any]] = []
    first_spk = labeled_segs[0]["speaker"]
    first_x = labeled_segs[0]["x"]
    first_pct = labeled_segs[0]["x_pct"]

    if labeled_segs[0]["start"] > 0.0:
        schedule.append({
            "start": 0.0,
            "end": labeled_segs[0]["start"],
            "speaker": first_spk,
            "x_pct": first_pct,
            "x": first_x,
        })

    for cur in labeled_segs:
        if schedule:
            prev = schedule[-1]
            if cur["start"] > prev["end"]:
                # Pause/gap: hold camera on previous speaker until next speaker begins
                schedule.append({
                    "start": prev["end"],
                    "end": cur["start"],
                    "speaker": prev["speaker"],
                    "x_pct": prev["x_pct"],
                    "x": prev["x"],
                })
            elif cur["start"] < prev["end"]:
                # Overlap: trim previous interval so cut happens when new speaker begins
                if cur["start"] > prev["start"]:
                    prev["end"] = cur["start"]
                else:
                    cur["start"] = prev["end"]

        schedule.append(dict(cur))

    if schedule[-1]["end"] < duration:
        last = schedule[-1]
        schedule.append({
            "start": last["end"],
            "end": duration,
            "speaker": last["speaker"],
            "x_pct": last["x_pct"],
            "x": last["x"],
        })

    # Merge adjacent segments with identical X
    merged: list[dict[str, Any]] = []
    for item in schedule:
        if merged and merged[-1]["x"] == item["x"]:
            merged[-1]["end"] = max(merged[-1]["end"], item["end"])
        else:
            merged.append(dict(item))

    return merged


def build_ffmpeg_crop_x_expr(schedule: list[dict[str, Any]], default_x: int = 314) -> str:
    """
    Constructs an FFmpeg expression for dynamic X crop coordinate.
    Example output: "if(lt(t,5.20),314,if(lt(t,12.50),2020,314))"
    """
    if not schedule:
        return str(default_x)

    all_x = [int(round(item["x"])) for item in schedule]
    if len(set(all_x)) == 1:
        return str(all_x[0])

    # Build nested if expression from right to left
    expr = str(int(round(schedule[-1]["x"])))
    for item in reversed(schedule[:-1]):
        t_switch = f"{float(item['end']):.2f}"
        x_val = int(round(item["x"]))
        expr = f"if(lt(t,{t_switch}),{x_val},{expr})"

    return expr
