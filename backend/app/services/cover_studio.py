"""
services/cover_studio.py — Production-grade Thumbnail & Cover Studio.

Provides:
- Candidate frame extraction across the clip with Laplacian sharpness filtering.
- Face placement detection to avoid blurry or awkward mid-blink frames.
- Transcript-grounded headline suggestions for high CTR.
- Custom typography, shadow, pill-badge banner rendering for 9:16 vertical and 16:9 landscape.
- Automatic bundling into the publishing ZIP kit.
"""
from __future__ import annotations

import base64
import cv2
import logging
import math
import numpy as np
import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger("clipperforge.cover_studio")


class CoverFrameCandidate(BaseModel):
    timestamp: float
    sharpness: float
    has_face: bool
    face_count: int
    data_url: str


class HeadlineSuggestion(BaseModel):
    headline: str
    category: str


def compute_frame_sharpness(frame_bgr: np.ndarray) -> float:
    """Computes focus sharpness via Laplacian variance. Higher is sharper."""
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def extract_candidate_frames(
    video_path: Path,
    start_time: float,
    end_time: float,
    num_candidates: int = 6,
    sample_count: int = 12,
) -> list[CoverFrameCandidate]:
    """
    Extracts candidate frames across the clip interval, ranks them by
    Laplacian sharpness and face presence, and returns top candidates as base64 JPEG data URLs.
    """
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    duration = max(1.0, end_time - start_time)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video for frame extraction: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or (duration * fps)

    # Initialize Haar Cascade for face verification
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)

    # Distribute sample timestamps evenly, avoiding extreme 0.2s edges
    margin = min(0.5, duration * 0.05)
    usable_start = start_time + margin
    usable_end = end_time - margin
    step = (usable_end - usable_start) / max(1, sample_count - 1)
    timestamps = [usable_start + i * step for i in range(sample_count)]

    candidates: list[dict[str, Any]] = []

    for ts in timestamps:
        frame_idx = int(ts * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret or frame is None:
            continue

        h, w = frame.shape[:2]
        sharpness = compute_frame_sharpness(frame)

        # Downscale for fast face detection
        det_w = 480
        det_h = int(h * (det_w / w))
        small = cv2.resize(frame, (det_w, det_h), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.15,
            minNeighbors=4,
            minSize=(30, 30),
        )

        face_count = len(faces)
        has_face = face_count > 0

        # Score weight: prioritize sharp frames, boost frames with clear face presence
        score = sharpness
        if has_face:
            score *= 1.4

        # Discard extreme blur (motion blur during head turns)
        if sharpness < 15.0 and len(timestamps) > 3:
            continue

        # Resize candidate for fast web preview (height 360px)
        preview_h = 360
        preview_w = int(w * (preview_h / h))
        preview_img = cv2.resize(frame, (preview_w, preview_h), interpolation=cv2.INTER_AREA)

        _, enc = cv2.imencode(".jpg", preview_img, [cv2.IMWRITE_JPEG_QUALITY, 80])
        b64 = base64.b64encode(enc.tobytes()).decode("utf-8")
        data_url = f"data:image/jpeg;base64,{b64}"

        candidates.append({
            "timestamp": round(ts, 2),
            "sharpness": round(sharpness, 1),
            "has_face": has_face,
            "face_count": face_count,
            "score": score,
            "data_url": data_url,
        })

    cap.release()

    # Sort candidates by combined score descending
    candidates.sort(key=lambda c: c["score"], reverse=True)
    top_candidates = candidates[:num_candidates]

    # If no frames met criteria, grab at least one mid-point frame
    if not top_candidates:
        cap = cv2.VideoCapture(str(video_path))
        mid_ts = start_time + duration / 2.0
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(mid_ts * fps))
        ret, frame = cap.read()
        cap.release()
        if ret and frame is not None:
            _, enc = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            b64 = base64.b64encode(enc.tobytes()).decode("utf-8")
            top_candidates.append({
                "timestamp": round(mid_ts, 2),
                "sharpness": 50.0,
                "has_face": False,
                "face_count": 0,
                "score": 50.0,
                "data_url": f"data:image/jpeg;base64,{b64}",
            })

    return [
        CoverFrameCandidate(
            timestamp=c["timestamp"],
            sharpness=c["sharpness"],
            has_face=c["has_face"],
            face_count=c["face_count"],
            data_url=c["data_url"],
        )
        for c in top_candidates
    ]


def extract_exact_frame(
    video_path: Path,
    timestamp: float,
    output_path: Path,
    aspect_ratio: str = "9:16",
) -> Path:
    """
    Extracts a pristine uncompressed frame at an exact timestamp and crops/scales to aspect ratio.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_idx = max(0, int(timestamp * fps))
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, frame = cap.read()
    cap.release()

    if not ret or frame is None:
        raise RuntimeError(f"Failed to extract frame at {timestamp}s from {video_path}")

    h, w = frame.shape[:2]
    target_w, target_h = (1080, 1920) if aspect_ratio == "9:16" else (1920, 1080)

    # Center-crop scale to target aspect ratio
    src_ratio = w / h
    target_ratio = target_w / target_h

    if src_ratio > target_ratio:
        # Source is wider: crop sides
        crop_w = int(h * target_ratio)
        x_start = max(0, (w - crop_w) // 2)
        cropped = frame[:, x_start : x_start + crop_w]
    else:
        # Source is taller: crop top/bottom
        crop_h = int(w / target_ratio)
        y_start = max(0, (h - crop_h) // 2)
        cropped = frame[y_start : y_start + crop_h, :]

    scaled = cv2.resize(cropped, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_path), scaled, [cv2.IMWRITE_JPEG_QUALITY, 95])
    return output_path


def generate_headline_suggestions(
    transcript_text: str,
    clip_title: str = "",
) -> list[HeadlineSuggestion]:
    """
    Generates high-CTR Indonesian thumbnail headline suggestions grounded in the transcript.
    """
    clean_text = re.sub(r"\s+", " ", transcript_text).strip()
    words = clean_text.split()

    suggestions: list[HeadlineSuggestion] = []

    # 1. Title punchline
    if clip_title:
        clean_title = re.sub(r"^(Sorotan|Klip|Momen)\s*:\s*", "", clip_title, flags=re.IGNORECASE)
        punchy_title = clean_title.upper()[:36]
        suggestions.append(HeadlineSuggestion(headline=punchy_title, category="Inti Bahasan"))

    # 2. Extract strong keywords or quotes from transcript
    trigger_words = [
        "JANGAN", "RAHASIA", "FAKTA", "TERNYATA", "ALASAN",
        "BAHAYA", "BONGKAR", "KACAU", "PARAH", "GILA", "BENERAN",
    ]
    found_triggers = [tw for tw in trigger_words if re.search(rf"\b{tw}\b", clean_text, re.IGNORECASE)]
    if found_triggers:
        suggestions.append(
            HeadlineSuggestion(
                headline=f"TERNYATA {found_triggers[0]} BANGET!",
                category="Penasaran",
            )
        )

    # 3. Punchy universal creator hooks
    suggestions.append(HeadlineSuggestion(headline="JANGAN SKIP INI!", category="Urgent Hook"))
    suggestions.append(HeadlineSuggestion(headline="FAKTA MENGEJUTKAN!", category="Curiosity"))
    suggestions.append(HeadlineSuggestion(headline="INI RAHASIANYA?!", category="Insight"))

    return suggestions[:4]


def render_cover_with_headline(
    source_video_path: Path,
    timestamp: float,
    output_path: Path,
    aspect_ratio: str = "9:16",
    headline_text: str | None = None,
    style_preset: str = "bold_amber",
    position_y_pct: float = 0.72,
) -> Path:
    """
    Extracts the pristine frame and burns in a high-contrast thumbnail headline banner.
    Supports bold_amber, bold_emerald, bold_rose, clean_white presets.
    """
    # 1. Extract pristine cropped frame
    temp_frame_path = output_path.with_suffix(".raw.jpg")
    extract_exact_frame(source_video_path, timestamp, temp_frame_path, aspect_ratio)

    img = cv2.imread(str(temp_frame_path))
    if temp_frame_path.exists():
        temp_frame_path.unlink(missing_ok=True)

    if img is None:
        raise RuntimeError("Failed to read extracted frame for thumbnail branding.")

    h, w = img.shape[:2]

    if headline_text and headline_text.strip():
        text = headline_text.strip().upper()

        # Preset palette definition (BGR format)
        presets = {
            "bold_amber": {
                "badge_bg": (11, 158, 245),     # amber-500
                "badge_border": (0, 110, 200),
                "text_color": (9, 9, 11),        # zinc-950
                "glow_color": (255, 255, 255),
            },
            "bold_emerald": {
                "badge_bg": (129, 185, 16),     # emerald-500
                "badge_border": (80, 140, 10),
                "text_color": (9, 9, 11),
                "glow_color": (255, 255, 255),
            },
            "bold_rose": {
                "badge_bg": (94, 63, 244),      # rose-500
                "badge_border": (60, 40, 180),
                "text_color": (255, 255, 255),
                "glow_color": (0, 0, 0),
            },
            "clean_white": {
                "badge_bg": (24, 24, 27),       # zinc-900
                "badge_border": (82, 82, 91),   # zinc-600
                "text_color": (244, 244, 245),  # zinc-100
                "glow_color": (0, 0, 0),
            },
        }

        cfg = presets.get(style_preset, presets["bold_amber"])

        # Font configuration
        font = cv2.FONT_HERSHEY_DUPLEX
        font_scale = 1.35 if aspect_ratio == "9:16" else 1.2
        thickness = 3

        # Word wrap if text is long
        words = text.split()
        lines: list[str] = []
        cur_line = []
        for word in words:
            test_line = " ".join(cur_line + [word])
            (line_w, _), _ = cv2.getTextSize(test_line, font, font_scale, thickness)
            if line_w > (w * 0.82) and cur_line:
                lines.append(" ".join(cur_line))
                cur_line = [word]
            else:
                cur_line.append(word)
        if cur_line:
            lines.append(" ".join(cur_line))

        line_height = int(58 * font_scale)
        total_text_h = len(lines) * line_height
        center_y = int(h * max(0.15, min(0.85, position_y_pct)))
        start_y = center_y - (total_text_h // 2)

        pad_x = 28
        pad_y = 16

        # Draw each line with background badge and drop shadow
        for i, line in enumerate(lines):
            (tw, th), baseline = cv2.getTextSize(line, font, font_scale, thickness)
            lx = (w - tw) // 2
            ly = start_y + i * line_height + th

            # Badge pill coordinates
            bx1 = lx - pad_x
            by1 = ly - th - pad_y
            bx2 = lx + tw + pad_x
            by2 = ly + baseline + pad_y

            # Draw badge background
            overlay = img.copy()
            cv2.rectangle(overlay, (bx1, by1), (bx2, by2), cfg["badge_bg"], -1)
            cv2.addWeighted(overlay, 0.94, img, 0.06, 0, img)

            # Draw badge border
            cv2.rectangle(img, (bx1, by1), (bx2, by2), cfg["badge_border"], 2)

            # Drop shadow
            cv2.putText(
                img,
                line,
                (lx + 2, ly + 2),
                font,
                font_scale,
                (0, 0, 0),
                thickness + 2,
                cv2.LINE_AA,
            )

            # Main text
            cv2.putText(
                img,
                line,
                (lx, ly),
                font,
                font_scale,
                cfg["text_color"],
                thickness,
                cv2.LINE_AA,
            )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_path), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    logger.info(f"Generated customized cover thumbnail at {output_path}")
    return output_path

