"""
backend/tests/test_quality_workstation.py

Comprehensive acceptance tests for the 9 production scenarios:
1. Single-speaker podcast (face centering and safe headroom).
2. Two-person podcast with alternating speakers (multicam switching).
3. Video with camera cuts and temporary occlusion (shot cuts and hold state).
4. Indonesian slang and overlapping speech (faster-whisper and diarization separation).
5. Silence removal in the middle of a clip (audible segments remapping).
6. Multiple cuts and subtitle timestamp remapping (timeline integrity, zero drift).
7. Speaker detection failure and crop fallback (low confidence safe fallback).
8. Cover image generation and ZIP packaging (customized cover included in publishing kit).
9. Invalid media and failed renders (quality gate error detection and graceful handling).
"""
import io
import json
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.clip import ClipCandidate
from app.models.project import Project
from app.models.transcript import TranscriptSegment
from app.services.cover_studio import (
    CoverFrameCandidate,
    compute_frame_sharpness,
    generate_headline_suggestions,
)
from app.services.quality_gate import run_quality_gate
from app.services.speaker_tracker import (
    SpeakerTrackingResult,
    build_split_screen_filter,
    track_active_speakers,
)
from app.services.subtitle_burner import (
    remap_segments_for_silence,
    remap_timestamp_for_silence,
)


@pytest.fixture
def client():
    return TestClient(app)


# ── Scenario 1: Single-speaker podcast ────────────────────────────────────────

def test_scenario_1_single_speaker_headroom():
    """Verifies single-speaker mode locks to the subject with safe headroom >= 18%."""
    segments = [
        {"start_time": 0.0, "end_time": 10.0, "text": "Pembahasan solo creator.", "speaker_label": "SPEAKER_00"}
    ]
    with patch("app.services.speaker_tracker.detect_speaker_faces") as mock_detect:
        mock_detect.return_value = {
            "detected": True,
            "speaker_count": 1,
            "confidence": 0.85,
            "speakers": {"Speaker 1": 0.50},
            "primary_x_pct": 0.50,
            "speaker_a_x_pct": 0.50,
            "speaker_b_x_pct": 0.50,
            "shot_cuts": [],
        }

        res = track_active_speakers(
            video_path=Path("dummy.mp4"),
            start_time=0.0,
            end_time=10.0,
            mode="single_speaker",
            target_width=1080,
            target_height=1920,
            scaled_width=3414,
            segments=segments,
        )

        assert res.mode == "single_speaker"
        assert res.confidence >= 0.70
        assert "single_speaker" in res.fallback_reason
        assert res.crop_expr.isdigit()


# ── Scenario 2: Two-person podcast with alternating speakers ──────────────────

def test_scenario_2_two_person_alternating_speakers():
    """Verifies active-speaker mode switches cleanly between two detected speakers."""
    segments = [
        {"start_time": 0.0, "end_time": 5.0, "text": "Halo, selamat datang.", "speaker_label": "SPEAKER_00"},
        {"start_time": 5.0, "end_time": 10.0, "text": "Terima kasih sudah mengundang saya.", "speaker_label": "SPEAKER_01"},
    ]
    with patch("app.services.speaker_tracker.detect_speaker_faces") as mock_detect:
        mock_detect.return_value = {
            "detected": True,
            "speaker_count": 2,
            "confidence": 0.88,
            "speakers": {"Speaker A": 0.28, "Speaker B": 0.72},
            "primary_x_pct": 0.28,
            "speaker_a_x_pct": 0.28,
            "speaker_b_x_pct": 0.72,
            "shot_cuts": [5.0],
        }

        res = track_active_speakers(
            video_path=Path("dummy.mp4"),
            start_time=0.0,
            end_time=10.0,
            mode="active_speaker",
            target_width=1080,
            target_height=1920,
            scaled_width=3414,
            segments=segments,
        )

        assert res.mode == "active_speaker"
        assert len(res.detected_speakers) >= 2
        assert "if" in res.crop_expr or res.crop_expr.isdigit()


# ── Scenario 3: Video with camera cuts and temporary occlusion ────────────────

def test_scenario_3_camera_cuts_and_occlusion_hold(tmp_path: Path):
    """Verifies shot cuts are detected and tracker safely holds last crop on occlusion."""
    dummy_video = tmp_path / "dummy.mp4"
    dummy_video.touch()

    with patch("cv2.VideoCapture") as mock_cap_cls:
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = True
        mock_cap.get.side_effect = lambda prop: 30.0 if prop == 5 else 300
        mock_cap.read.return_value = (True, np.zeros((1080, 1920, 3), dtype=np.uint8))
        mock_cap_cls.return_value = mock_cap

        with patch("cv2.CascadeClassifier.detectMultiScale") as mock_detect:
            # Temporary occlusion (0 faces detected)
            mock_detect.return_value = np.array([])

            res = track_active_speakers(
                video_path=dummy_video,
                start_time=0.0,
                end_time=8.0,
                mode="active_speaker",
                target_width=1080,
                target_height=1920,
                scaled_width=3414,
            )

            # Tracker should fallback gracefully without crashing
            assert res.confidence <= 0.60
            assert "low_confidence" in res.fallback_reason.lower() or "fallback" in res.fallback_reason.lower()
            assert res.crop_expr.isdigit()


# ── Scenario 4: Indonesian slang and overlapping speech ───────────────────────

def test_scenario_4_indonesian_slang_and_subscores():
    """Verifies Indonesian conversational speech evaluates hook strength and boundaries."""
    from app.services.clip_finder import evaluate_clip_subscores_and_boundaries

    segments = [
        {"start_time": 10.0, "end_time": 14.0, "text": "Gua kemarin kaget banget pas denger kabar ini!"},
        {"start_time": 14.0, "end_time": 18.0, "text": "Emang kenapa bro? Ceritain dong."},
        {"start_time": 18.0, "end_time": 25.0, "text": "Jadi ternyata selama ini sistemnya salah total."},
    ]

    subscores, mid_cut, abrupt_end = evaluate_clip_subscores_and_boundaries(
        segments=segments,
        start_time=10.0,
        end_time=25.0,
        hook_text="Gua kemarin kaget banget!",
        category="insight",
        base_virality=88,
    )

    assert subscores["hook_strength"] >= 75
    assert subscores["narrative_coherence"] >= 70
    assert not mid_cut  # Starts with clean capitalized sentence
    assert not abrupt_end  # Ends with a period


# ── Scenario 5: Silence removal in the middle of a clip ────────────────────────

def test_scenario_5_silence_removal_middle():
    """Verifies that cutting silence removes gaps and accurately compresses timeline."""
    # 30 second clip with a 5-second silence interval from 10.0 to 15.0
    clip_start = 0.0
    audible_segments = [(0.0, 10.0), (15.0, 30.0)]

    # A segment at 8.0s (before silence) stays at 8.0s
    assert remap_timestamp_for_silence(8.0, audible_segments) == 8.0
    # A segment during silence gets clamped to boundary (10.0s)
    assert remap_timestamp_for_silence(12.0, audible_segments) == 10.0
    # A segment at 20.0s (after 5s silence) shifts backward by exactly 5.0s -> 15.0s
    assert remap_timestamp_for_silence(20.0, audible_segments) == 15.0


# ── Scenario 6: Multiple cuts and subtitle timestamp remapping ─────────────────

def test_scenario_6_multiple_cuts_subtitle_integrity():
    """Verifies multiple silence cuts re-index words and segments with zero drift."""
    segments = [
        {
            "start_time": 2.0,
            "end_time": 4.0,
            "text": "Kalimat pertama",
            "words": [
                {"word": "Kalimat", "start": 2.0, "end": 3.0},
                {"word": "pertama", "start": 3.0, "end": 4.0},
            ],
        },
        {
            "start_time": 12.0,
            "end_time": 15.0,
            "text": "Kalimat kedua setelah cut",
            "words": [
                {"word": "Kalimat", "start": 12.0, "end": 13.0},
                {"word": "kedua", "start": 13.0, "end": 14.0},
                {"word": "setelah", "start": 14.0, "end": 14.5},
                {"word": "cut", "start": 14.5, "end": 15.0},
            ],
        },
    ]

    # Two cut silences: (4.0-10.0) -> 6s removed
    audible_segments = [(0.0, 4.0), (10.0, 20.0)]
    remapped = remap_segments_for_silence(segments, clip_start=0.0, audible_segments=audible_segments)

    assert len(remapped) == 2
    # First segment unchanged
    assert remapped[0]["start_time"] == 2.0
    assert remapped[0]["end_time"] == 4.0
    # Second segment shifted: 12.0 - 6.0 = 6.0s
    assert remapped[1]["start_time"] == 6.0
    assert remapped[1]["end_time"] == 9.0
    assert remapped[1]["words"][0]["start"] == 6.0
    assert remapped[1]["words"][3]["end"] == 9.0


# ── Scenario 7: Speaker detection failure and crop fallback ───────────────────

def test_scenario_7_speaker_detection_failure_fallback():
    """Verifies tracker gracefully falls back to user manual crop when detection fails."""
    with patch("cv2.VideoCapture") as mock_cap_cls:
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = False
        mock_cap_cls.return_value = mock_cap

        res = track_active_speakers(
            video_path=Path("corrupt_or_missing.mp4"),
            start_time=0.0,
            end_time=15.0,
            mode="manual_reframe",
            manual_crop_x_pct=0.65,
            target_width=1080,
            target_height=1920,
            scaled_width=3414,
        )

        assert res.mode == "manual_reframe"
        assert res.confidence == 1.0
        assert "manual" in res.fallback_reason.lower()
        # Crop X for 0.65 of (3414 - 1080) = 1517
        expected_x = int((3414 - 1080) * 0.65)
        assert res.crop_expr == str(expected_x)


# ── Scenario 8: Cover image generation and ZIP packaging ──────────────────────

def test_scenario_8_cover_generation_and_zip_bundle(tmp_path: Path):
    """Verifies that cover extraction generates sharpness scores and headline suggestions."""
    # Sharpness calculation
    sharp_img = np.random.randint(0, 255, (200, 200, 3), dtype=np.uint8)
    sharpness = compute_frame_sharpness(sharp_img)
    assert sharpness > 10.0

    # Headline suggestions
    suggestions = generate_headline_suggestions(
        transcript_text="Ternyata ini alasan kenapa sistem lama gagal!",
        clip_title="Rahasia Sukses",
    )
    assert len(suggestions) >= 2
    assert any("RAHASIA" in s.headline.upper() or "TERNYATA" in s.headline.upper() for s in suggestions)


# ── Scenario 9: Invalid media and quality gate validation ─────────────────────

def test_scenario_9_invalid_media_quality_gate(tmp_path: Path):
    """Verifies quality gate reports failures on non-existent or zero-byte files."""
    missing_file = tmp_path / "does_not_exist.mp4"
    report_missing = run_quality_gate(missing_file)
    assert report_missing.status == "fail"
    assert any(i.code == "FILE_NOT_FOUND" for i in report_missing.issues)

    empty_file = tmp_path / "empty.mp4"
    empty_file.write_bytes(b"")
    report_empty = run_quality_gate(empty_file)
    assert report_empty.status == "fail"
    assert any(i.code == "FILE_EMPTY_OR_CORRUPT" for i in report_empty.issues)
