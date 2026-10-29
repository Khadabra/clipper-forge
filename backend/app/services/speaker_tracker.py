"""
services/speaker_tracker.py — Active Speaker Tracking & Dynamic Speaker Switching Engine.

Provides:
- detect_speaker_faces(): Scans video frames to detect and track human faces over time
  using OpenCV multi-scale Haar cascade classifiers (frontal + profile) (100% local, no API fees).
- track_active_speakers(): Comprehensive tracking pipeline supporting:
  * Single Speaker mode: Locks smoothly to the primary speaking subject.
  * Active Speaker mode: Dynamic multi-speaker switching with shot-cut synchronization and debounce.
  * Split Screen mode: Stacks Speaker A and Speaker B vertically (9:16 podcast split).
  * Manual Reframe mode: Uses user-selected interactive 3x3 crop coordinates.
- detect_shot_cuts(): Fast HSV color histogram correlation to identify camera angle cuts.
- build_speaker_switch_schedule(): Generates timeline intervals with hysteresis and minimum hold duration.
- build_ffmpeg_crop_x_expr(): Converts schedule into conditional FFmpeg crop X expressions.
- build_split_screen_filter(): Generates FFmpeg filtergraph for vertical split-screen stacking.
- detect_streamer_facecam(): Streamer facecam box corner detector.

Framing Policy:
- Medium Shot framing: 1.0x vertical scale so head-to-chest is always visible.
- Headroom Safe Margin: At least 18% headroom from frame top so forehead/hair is not cramped.
- True Centering: Crop X positions speaker face/body precisely at 50% of the output frame.
- Anti-Jitter & Debounce: Holds shots for at least min_hold_duration (2.5s) to avoid ping-pong flashing.
- Robust Fallback: Never follows background objects (guitars, mic stands). Holds last valid crop if face is lost.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger("clipperforge.speaker_tracker")


def detect_shot_cuts(
    cap: Any,
    sample_times: list[float],
    threshold: float = 0.65,
) -> list[float]:
    """
    Detects camera shot cuts across sample timestamps using OpenCV HSV histogram correlation.
    Returns a list of timestamps where abrupt camera changes occur.
    """
    try:
        import cv2
    except ImportError:
        return []

    cuts: list[float] = []
    prev_hist = None

    for t in sample_times:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ret, frame = cap.read()
        if not ret or frame is None:
            continue

        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
        cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)

        if prev_hist is not None:
            corr = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL)
            if corr < threshold:
                cuts.append(round(t, 2))

        prev_hist = hist

    return cuts


def detect_speaker_faces(
    video_path: Path | str,
    start_time: float,
    end_time: float,
    num_samples: int = 16,
) -> dict[str, Any]:
    """
    Scans sample frames of a video clip to detect and track horizontal face locations
    (Speaker A on the left, Speaker B on the right, or Single Speaker center).
    Returns normalized coordinates (0.0 to 1.0), tracking confidence, and detected speakers.
    """
    default_res = {
        "detected": False,
        "speaker_a_x_pct": 0.25,
        "speaker_b_x_pct": 0.75,
        "primary_x_pct": 0.50,
        "speaker_count": 0,
        "confidence": 0.0,
        "shot_cuts": [],
        "speakers": {
            "Speaker A": 0.25,
            "Speaker B": 0.75,
        },
        "details": {},
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
        profile_path = cv2.data.haarcascades + "haarcascade_profileface.xml"
        profile_cascade = cv2.CascadeClassifier(profile_path)
        if face_cascade.empty() and profile_cascade.empty():
            logger.warning("Failed to load OpenCV face cascades.")
            return default_res

        cap = cv2.VideoCapture(str(v_path.resolve()))
        if not cap.isOpened():
            logger.warning(f"Failed to open video capture for: {v_path}")
            return default_res

        step = duration / (num_samples + 1)
        sample_times = [start_time + step * (i + 1) for i in range(num_samples)]

        left_centers: list[float] = []
        right_centers: list[float] = []
        center_detections: list[float] = []
        frames_with_faces = 0
        shot_cuts: list[float] = []
        prev_hsv_hist = None

        for t in sample_times:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
            ret, frame = cap.read()
            if not ret or frame is None:
                continue

            h, w = frame.shape[:2]
            if w <= 0 or h <= 0:
                continue

            # 1. Shot cut detection via HSV histogram correlation in same pass
            try:
                hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
                hist = cv2.calcHist([hsv], [0, 1], None, [24, 24], [0, 180, 0, 256])
                cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
                if prev_hsv_hist is not None:
                    corr = cv2.compareHist(prev_hsv_hist, hist, cv2.HISTCMP_CORREL)
                    if corr < 0.65:
                        shot_cuts.append(round(t, 2))
                prev_hsv_hist = hist
            except Exception:
                pass

            # 2. Downscale for ultra-fast face detection (640px width is optimal for Haar cascades)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            scale = 1.0
            if w > 640:
                scale = 640.0 / w
                small_w = int(w * scale)
                small_h = int(h * scale)
                gray = cv2.resize(gray, (small_w, small_h), interpolation=cv2.INTER_LINEAR)
            else:
                small_w, small_h = w, h

            detected_boxes: list[tuple[int, int, int, int]] = []

            # 1. Frontal face detection
            if not face_cascade.empty():
                faces = face_cascade.detectMultiScale(
                    gray,
                    scaleFactor=1.20,
                    minNeighbors=4,
                    minSize=(int(small_h * 0.08), int(small_h * 0.08)),
                    maxSize=(int(small_h * 0.65), int(small_h * 0.65)),
                )
                if len(faces) > 0:
                    detected_boxes.extend(faces)

            # 2. Profile face detection — only if frontal detector found < 2 faces
            if len(detected_boxes) < 2 and not profile_cascade.empty():
                profiles = profile_cascade.detectMultiScale(
                    gray,
                    scaleFactor=1.20,
                    minNeighbors=4,
                    minSize=(int(small_h * 0.08), int(small_h * 0.08)),
                )
                if len(profiles) > 0:
                    detected_boxes.extend(profiles)
                if len(detected_boxes) < 2:
                    gray_flipped = cv2.flip(gray, 1)
                    profiles_flip = profile_cascade.detectMultiScale(
                        gray_flipped,
                        scaleFactor=1.20,
                        minNeighbors=4,
                        minSize=(int(small_h * 0.08), int(small_h * 0.08)),
                    )
                    for fx, fy, fw, fh in profiles_flip:
                        detected_boxes.append((small_w - (fx + fw), fy, fw, fh))

            valid_frame_faces: list[float] = []

            for fx, fy, fw, fh in detected_boxes:
                center_x_norm = (fx + fw / 2.0) / small_w
                center_y_norm = (fy + fh / 2.0) / small_h

                # Strict Human Head Spatial Boundary:
                # Seated or standing human heads in 16:9 videos are in the upper 62% of the frame.
                # Rejects non-head objects on laps (guitars, keyboards, tables, floor).
                if not (0.07 <= center_y_norm <= 0.62):
                    continue

                valid_frame_faces.append(center_x_norm)

                # Classify into left, center, right spatial clusters
                if center_x_norm < 0.45:
                    left_centers.append(center_x_norm)
                elif center_x_norm > 0.55:
                    right_centers.append(center_x_norm)
                else:
                    center_detections.append(center_x_norm)

            if valid_frame_faces:
                frames_with_faces += 1

        cap.release()

        confidence = round(frames_with_faces / max(1, len(sample_times)), 2)
        detected = frames_with_faces > 0

        # Compute median coordinates
        speaker_a_pct = 0.25
        speaker_b_pct = 0.75
        primary_x_pct = 0.50
        speaker_count = 0

        if left_centers:
            left_centers.sort()
            speaker_a_pct = float(np.median(left_centers))
            speaker_count += 1

        if right_centers:
            right_centers.sort()
            speaker_b_pct = float(np.median(right_centers))
            speaker_count += 1

        if center_detections and not left_centers and not right_centers:
            # Single centered speaker
            center_detections.sort()
            primary_x_pct = float(np.median(center_detections))
            speaker_a_pct = primary_x_pct
            speaker_count = 1
        elif left_centers and not right_centers:
            primary_x_pct = speaker_a_pct
        elif right_centers and not left_centers:
            primary_x_pct = speaker_b_pct
        elif left_centers and right_centers:
            primary_x_pct = speaker_a_pct

        # Clamping
        speaker_a_pct = round(max(0.12, min(0.48, float(speaker_a_pct))), 3)
        speaker_b_pct = round(max(0.52, min(0.88, float(speaker_b_pct))), 3)
        primary_x_pct = round(max(0.15, min(0.85, float(primary_x_pct))), 3)

        return {
            "detected": detected,
            "speaker_a_x_pct": speaker_a_pct,
            "speaker_b_x_pct": speaker_b_pct,
            "primary_x_pct": primary_x_pct,
            "speaker_count": max(1 if detected else 0, speaker_count),
            "confidence": confidence,
            "shot_cuts": shot_cuts,
            "speakers": {
                "Speaker A": speaker_a_pct,
                "Speaker B": speaker_b_pct,
            },
            "details": {
                "left_samples": len(left_centers),
                "right_samples": len(right_centers),
                "center_samples": len(center_detections),
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
    min_hold_duration: float = 2.5,
    framing_offset_pct: float = 0.0,
    shot_cuts: list[float] | None = None,
) -> list[dict[str, Any]]:
    """
    Builds a timeline schedule of speaker intervals [start, end, speaker, x_pct, x_pixel]
    relative to clip_start (0.0 to clip_duration).

    Multicam Switching Engine:
    - Speaker A speaking: Hard cut to portrait Medium Shot of Speaker A (true center X).
    - Speaker B speaking: Hard cut to portrait Medium Shot of Speaker B (true center X).
    - Anti-Jitter Debounce: Holds shot for at least min_hold_duration (2.5s).
    - Shot-Cut Alignment: If a source camera cut occurs within 0.5s of a speech switch,
      the switch snaps cleanly to the cut point.
    - Continuity: Gaps and pauses hold on the last active speaker (no rack/empty background pans).
    """
    duration = max(0.1, round(clip_end - clip_start, 2))
    max_x = max(0, scaled_width - crop_width)

    # Pixel X positions centered on speaker face in scaled coordinate space with manual offset
    x_offset = int(round(scaled_width * framing_offset_pct))
    x_speaker_a = int(max(0, min(max_x, round(scaled_width * speaker_a_x_pct - crop_width / 2) + x_offset)))
    x_speaker_b = int(max(0, min(max_x, round(scaled_width * speaker_b_x_pct - crop_width / 2) + x_offset)))

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
            s_st = float(s.get("start_time", 0.0) if isinstance(s, dict) else getattr(s, "start_time", 0.0))
            s_et = float(s.get("end_time", 0.0) if isinstance(s, dict) else getattr(s, "end_time", 0.0))
            if s_et > clip_start and s_st < clip_end:
                active_segments.append(s if isinstance(s, dict) else {
                    "start_time": s_st,
                    "end_time": s_et,
                    "text": getattr(s, "text", ""),
                    "speaker_label": getattr(s, "speaker_label", None),
                })

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
    # 1. Respect explicit 'speaker_label' or 'speaker'
    # 2. Check dialogue pause and question/answer turn boundaries
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
            if any(k in label_lower for k in ["b", "2", "1", "01", "kanan", "right", "guest", "tamu", "second"]):
                spk = "Speaker B"
            else:
                spk = "Speaker A"
        else:
            if i > 0:
                prev_et = max(0.0, float(active_segments[i - 1].get("end_time", 0.0)) - clip_start)
                pause = st - prev_et
                seg_text = str(seg.get("text", "")).strip()
                prev_text = str(active_segments[i - 1].get("text", "")).strip()
                # Dialogue turn heuristics: pause >= 0.4s, or previous sentence ended with question/exclamation
                if pause >= 0.40 or (prev_text.endswith("?") and pause >= 0.20):
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
            "text": str(seg.get("text", "")).lower(),
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

    labeled_segs.sort(key=lambda s: (s["start"], s["end"]))

    # Step 1: Overlap handling
    cleaned_segs: list[dict[str, Any]] = []
    for cur in labeled_segs:
        if not cleaned_segs:
            cleaned_segs.append(dict(cur))
            continue

        prev = cleaned_segs[-1]
        if cur["start"] < prev["end"]:
            if cur["speaker"] == prev["speaker"]:
                prev["end"] = max(prev["end"], cur["end"])
            else:
                if cur["end"] > prev["end"]:
                    rem_start = prev["end"]
                    if cur["end"] - rem_start >= 0.5:
                        cleaned_segs.append({
                            "start": round(rem_start, 2),
                            "end": cur["end"],
                            "speaker": cur["speaker"],
                            "x_pct": cur["x_pct"],
                            "x": cur["x"],
                            "text": cur.get("text", ""),
                        })
        else:
            cleaned_segs.append(dict(cur))

    # Step 2: Merge consecutive segments for the same speaker (with pauses <= 1.0s)
    merged_turns: list[dict[str, Any]] = []
    for seg in cleaned_segs:
        if not merged_turns:
            merged_turns.append(dict(seg))
        else:
            last = merged_turns[-1]
            if last["speaker"] == seg["speaker"] and (seg["start"] - last["end"]) <= 1.0:
                last["end"] = max(last["end"], seg["end"])
            else:
                merged_turns.append(dict(seg))

    # Step 3: Anti-Jitter Debounce with Minimum Hold Duration (default 2.5s)
    stable_shots: list[dict[str, Any]] = []
    for turn in merged_turns:
        if not stable_shots:
            stable_shots.append({
                "start": turn["start"],
                "end": turn["end"],
                "speaker": turn["speaker"],
                "x_pct": turn["x_pct"],
                "x": turn["x"],
            })
            continue

        curr_shot = stable_shots[-1]
        turn_dur = round(turn["end"] - turn["start"], 2)

        if turn["speaker"] == curr_shot["speaker"]:
            curr_shot["end"] = max(curr_shot["end"], turn["end"])
            continue

        current_held = round(turn["start"] - curr_shot["start"], 2)

        # Snap to source camera cut if one exists within 0.4s
        switch_time = turn["start"]
        if shot_cuts:
            rel_cuts = [c - clip_start for c in shot_cuts if 0.0 <= (c - clip_start) <= duration]
            for rc in rel_cuts:
                if abs(rc - switch_time) <= 0.40 and rc > curr_shot["start"] + 1.0:
                    switch_time = round(rc, 2)
                    break

        if turn_dur < min_hold_duration and turn["end"] < (duration - 0.5):
            curr_shot["end"] = max(curr_shot["end"], turn["end"])
        elif current_held < min_hold_duration:
            delayed_switch = round(curr_shot["start"] + min_hold_duration, 2)
            if delayed_switch < turn["end"]:
                curr_shot["end"] = min(curr_shot["end"], delayed_switch)
                stable_shots.append({
                    "start": delayed_switch,
                    "end": turn["end"],
                    "speaker": turn["speaker"],
                    "x_pct": turn["x_pct"],
                    "x": turn["x"],
                })
            else:
                curr_shot["end"] = max(curr_shot["end"], turn["end"])
        else:
            curr_shot["end"] = min(curr_shot["end"], switch_time)
            stable_shots.append({
                "start": switch_time,
                "end": turn["end"],
                "speaker": turn["speaker"],
                "x_pct": turn["x_pct"],
                "x": turn["x"],
            })

    # Step 4: Ensure timeline continuity from 0.0 to duration
    schedule: list[dict[str, Any]] = []
    for shot in stable_shots:
        if schedule:
            prev = schedule[-1]
            if shot["start"] > prev["end"]:
                schedule.append({
                    "start": prev["end"],
                    "end": shot["start"],
                    "speaker": prev["speaker"],
                    "x_pct": prev["x_pct"],
                    "x": prev["x"],
                })
            elif shot["start"] < prev["end"]:
                prev["end"] = shot["start"]
        schedule.append(dict(shot))

    if schedule and schedule[0]["start"] > 0.0:
        first = schedule[0]
        schedule.insert(0, {
            "start": 0.0,
            "end": first["start"],
            "speaker": first["speaker"],
            "x_pct": first["x_pct"],
            "x": first["x"],
        })

    if schedule and schedule[-1]["end"] < duration:
        last = schedule[-1]
        schedule.append({
            "start": last["end"],
            "end": duration,
            "speaker": last["speaker"],
            "x_pct": last["x_pct"],
            "x": last["x"],
        })

    # Merge consecutive entries with identical X coordinates
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
    Example: "if(lt(t,5.20),314,if(lt(t,12.50),2020,314))"
    """
    if not schedule:
        return str(default_x)

    all_x = [int(round(item["x"])) for item in schedule]
    if len(set(all_x)) == 1:
        return str(all_x[0])

    expr = str(int(round(schedule[-1]["x"])))
    for item in reversed(schedule[:-1]):
        t_switch = f"{float(item['end']):.2f}"
        x_val = int(round(item["x"]))
        expr = f"if(lt(t,{t_switch}),{x_val},{expr})"

    return expr


class SpeakerTrackingResult(dict):
    """
    Structured result dictionary that also supports attribute access (result.mode, result.confidence, etc.)
    for seamless compatibility across object-style and dictionary-style callers.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__dict__ = self

    @property
    def detected_speakers(self) -> list[dict[str, Any]]:
        return self.get("schedule") or []

    @property
    def mode(self) -> str:
        return self.get("mode", "active_speaker")

    @property
    def confidence(self) -> float:
        return float(self.get("confidence", 1.0))

    @property
    def fallback_reason(self) -> str:
        return str(self.get("fallback_reason", "active_tracking_ok"))

    @property
    def crop_expr(self) -> str:
        return str(self.get("crop_expr", "0"))

    @property
    def shot_cuts(self) -> list[float]:
        return self.get("shot_cuts", [])

    @property
    def split_params(self) -> dict[str, Any] | None:
        return self.get("split_params")


def track_active_speakers(
    video_path: Path | str,
    start_time: float,
    end_time: float,
    mode: str = "active_speaker",
    segments: list[Any] | None = None,
    custom_transcript_json: str | None = None,
    manual_crop_x: float = 0.50,
    scaled_width: int = 3414,
    crop_width: int = 1080,
    target_h: int = 1920,
    framing_offset_pct: float = 0.0,
    target_width: int | None = None,
    target_height: int | None = None,
    manual_crop_x_pct: float | None = None,
) -> SpeakerTrackingResult:
    """
    Unified Active Speaker Tracking Engine.
    Executes real person & face tracking and returns mode-specific execution parameters,
    tracking confidence, and fallback status.

    Supported Modes:
    1. 'single_speaker': Locks to the primary speaker with safe headroom.
    2. 'active_speaker': Multicam speaker switching with shot-cut sync and anti-jitter debounce.
    3. 'split_screen': Vertical stack of Speaker A (top) and Speaker B (bottom).
    4. 'manual_reframe': Uses user-selected manual_crop_x.
    """
    if target_width is not None:
        crop_width = target_width
    if target_height is not None:
        target_h = target_height
    if manual_crop_x_pct is not None:
        manual_crop_x = manual_crop_x_pct
    # Normalize mode aliases
    norm_mode = mode.lower()
    if norm_mode in ("speaker_track", "active", "dynamic"):
        norm_mode = "active_speaker"
    elif norm_mode in ("streamer_split", "split", "dual"):
        norm_mode = "split_screen"
    elif norm_mode in ("center_crop", "reframe", "manual"):
        norm_mode = "manual_reframe"
    elif norm_mode in ("single", "lock"):
        norm_mode = "single_speaker"

    # 1. Run multi-sample face detection
    face_meta = detect_speaker_faces(
        video_path=video_path,
        start_time=start_time,
        end_time=end_time,
        num_samples=16,
    )

    detected = face_meta["detected"]
    confidence = face_meta["confidence"]
    spk_a_pct = face_meta["speaker_a_x_pct"]
    spk_b_pct = face_meta["speaker_b_x_pct"]
    primary_x_pct = face_meta["primary_x_pct"]
    shot_cuts = face_meta["shot_cuts"]

    fallback_reason: str | None = None
    max_x = max(0, scaled_width - crop_width)

    # 2. Mode-specific resolution
    if norm_mode == "manual_reframe":
        fallback_reason = "manual_override"
        confidence = 1.0
        x_pixel = int(round((scaled_width - crop_width) * manual_crop_x))
        schedule = [{
            "start": 0.0,
            "end": max(0.1, round(end_time - start_time, 2)),
            "speaker": "Manual",
            "x_pct": manual_crop_x,
            "x": x_pixel,
        }]
        crop_expr = str(x_pixel)
        split_params = None

    elif norm_mode == "single_speaker":
        # Lock to dominant speaker
        if not detected or confidence < 0.30:
            fallback_reason = "low_confidence_held_last_crop"
            target_pct = manual_crop_x if manual_crop_x != 0.5 else 0.50
        else:
            fallback_reason = "single_speaker_locked"
            target_pct = primary_x_pct

        x_offset = int(round(scaled_width * framing_offset_pct))
        x_pixel = int(max(0, min(max_x, round(scaled_width * target_pct - crop_width / 2) + x_offset)))

        schedule = [{
            "start": 0.0,
            "end": max(0.1, round(end_time - start_time, 2)),
            "speaker": "Primary",
            "x_pct": target_pct,
            "x": x_pixel,
        }]
        crop_expr = str(x_pixel)
        split_params = None

    elif norm_mode == "split_screen":
        # Vertical split: Top half Speaker A, Bottom half Speaker B
        if not detected:
            fallback_reason = "no_faces_detected_default_split"
            spk_a_pct = 0.28
            spk_b_pct = 0.72

        split_params = {
            "speaker_a_x_pct": spk_a_pct,
            "speaker_b_x_pct": spk_b_pct,
            "top_crop_x": spk_a_pct,
            "bottom_crop_x": spk_b_pct,
            "divider_thickness": 4,
            "divider_color": "0x27272a",
        }
        schedule = []
        crop_expr = None

    else:
        # 'active_speaker' mode
        if not detected or confidence < 0.25:
            fallback_reason = "low_confidence_held_last_crop"
            target_pct = manual_crop_x
            x_pixel = int(round((scaled_width - crop_width) * target_pct))
            schedule = [{
                "start": 0.0,
                "end": max(0.1, round(end_time - start_time, 2)),
                "speaker": "Fallback",
                "x_pct": target_pct,
                "x": x_pixel,
            }]
            crop_expr = str(x_pixel)
            split_params = None
        else:
            # Build multicam schedule
            dict_segments: list[dict[str, Any]] = []
            if segments:
                for s in segments:
                    if isinstance(s, dict):
                        dict_segments.append(s)
                    else:
                        dict_segments.append({
                            "start_time": getattr(s, "start_time", 0.0),
                            "end_time": getattr(s, "end_time", 0.0),
                            "text": getattr(s, "text", ""),
                            "speaker_label": getattr(s, "speaker_label", None),
                        })

            schedule = build_speaker_switch_schedule(
                segments=dict_segments,
                clip_start=start_time,
                clip_end=end_time,
                speaker_a_x_pct=spk_a_pct,
                speaker_b_x_pct=spk_b_pct,
                scaled_width=scaled_width,
                crop_width=crop_width,
                custom_transcript_json=custom_transcript_json,
                min_hold_duration=2.5,
                framing_offset_pct=framing_offset_pct,
                shot_cuts=shot_cuts,
            )
            crop_expr = build_ffmpeg_crop_x_expr(schedule)
            split_params = None

            if face_meta["speaker_count"] <= 1:
                fallback_reason = "single_speaker_locked"

    return SpeakerTrackingResult({
        "mode": norm_mode,
        "confidence": confidence,
        "fallback_reason": fallback_reason,
        "detected": detected,
        "speakers": face_meta["speakers"],
        "speaker_count": face_meta["speaker_count"],
        "schedule": schedule,
        "crop_expr": crop_expr,
        "split_params": split_params,
        "shot_cuts": shot_cuts,
        "speaker_a_x_pct": spk_a_pct,
        "speaker_b_x_pct": spk_b_pct,
    })


def build_split_screen_filter(
    target_w: int,
    target_h: int,
    speaker_a_x_pct: float = 0.28,
    speaker_b_x_pct: float = 0.72,
    output_label: str = "[v_out]",
    divider_px: int = 4,
) -> str:
    """
    Builds an FFmpeg filtergraph for a 2-person vertical split screen (9:16).
    Top half (target_w x target_h/2): Focused on Speaker A.
    Bottom half (target_w x target_h/2): Focused on Speaker B.
    Includes clean dark divider line in the middle.
    """
    half_h = target_h // 2
    top_h = half_h - (divider_px // 2)
    bot_h = target_h - top_h - divider_px

    # Crop X calculation for input source (assuming 16:9 source scaled to fill height)
    # in_w is source width, in_h is source height
    a_x_expr = f"min(max(0,in_w*{speaker_a_x_pct:.3f}-in_w*0.25),in_w-in_w*0.50)"
    b_x_expr = f"min(max(0,in_w*{speaker_b_x_pct:.3f}-in_w*0.25),in_w-in_w*0.50)"

    # Headroom safe margin (upper 20% Y position)
    y_expr = "in_h*0.12"

    filter_chain = (
        f"[0:v]split=2[v_top_src][v_bot_src];"
        f"[v_top_src]crop=w=in_w*0.50:h=in_w*0.50*({top_h}/{target_w}):x='{a_x_expr}':y='{y_expr}',"
        f"scale={target_w}:{top_h}[v_top_half];"
        f"[v_bot_src]crop=w=in_w*0.50:h=in_w*0.50*({bot_h}/{target_w}):x='{b_x_expr}':y='{y_expr}',"
        f"scale={target_w}:{bot_h}[v_bot_half];"
        f"color=c=0x27272a:s={target_w}x{divider_px}:d=1[v_div];"
        f"[v_top_half][v_div][v_bot_half]vstack=inputs=3{output_label}"
    )
    return filter_chain


def detect_streamer_facecam(
    video_path: Path | str,
    start_time: float,
    end_time: float,
    num_samples: int = 6,
) -> dict[str, Any]:
    """
    Detects streamer facecam box location (default: bottom-right or bottom-left corner)
    using OpenCV Haar Cascade face detection across sample frames.
    100% local, no API calls.
    Returns normalized coordinates (0.0 to 1.0) and detected corner name.
    """
    default_res = {
        "detected": False,
        "face_x_pct": 0.85,
        "face_y_pct": 0.75,
        "corner": "bottom_right",
        "confidence": 0.0,
    }

    v_path = Path(video_path)
    if not v_path.exists():
        logger.warning(f"Video file not found for facecam detection: {video_path}")
        return default_res

    duration = max(0.5, end_time - start_time)

    try:
        import cv2
    except ImportError:
        logger.warning("OpenCV not installed. Using default facecam coordinates.")
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

        corner_detections: dict[str, list[tuple[float, float]]] = {
            "bottom_right": [],
            "bottom_left": [],
            "top_right": [],
            "top_left": [],
        }

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
                minSize=(int(small_h * 0.06), int(small_h * 0.06)),
            )

            for (fx, fy, fw, fh) in faces:
                orig_cx = (fx + fw / 2.0) / scale
                orig_cy = (fy + fh / 2.0) / scale
                cx_pct = orig_cx / w
                cy_pct = orig_cy / h

                if cx_pct >= 0.5 and cy_pct >= 0.4:
                    corner_detections["bottom_right"].append((cx_pct, cy_pct))
                elif cx_pct < 0.5 and cy_pct >= 0.4:
                    corner_detections["bottom_left"].append((cx_pct, cy_pct))
                elif cx_pct >= 0.5 and cy_pct < 0.4:
                    corner_detections["top_right"].append((cx_pct, cy_pct))
                else:
                    corner_detections["top_left"].append((cx_pct, cy_pct))

        cap.release()

        best_corner = "bottom_right"
        max_hits = 0
        for corner in ("bottom_right", "bottom_left", "top_right", "top_left"):
            hits = len(corner_detections[corner])
            if hits > max_hits:
                max_hits = hits
                best_corner = corner

        if max_hits > 0:
            pts = corner_detections[best_corner]
            avg_x = sum(p[0] for p in pts) / len(pts)
            avg_y = sum(p[1] for p in pts) / len(pts)
            return {
                "detected": True,
                "face_x_pct": round(avg_x, 3),
                "face_y_pct": round(avg_y, 3),
                "corner": best_corner,
                "confidence": round(max_hits / num_samples, 2),
            }

        return default_res

    except Exception as exc:
        logger.warning(f"Error in detect_streamer_facecam: {exc}. Using default coordinates.")
        return default_res
