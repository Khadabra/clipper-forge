"""
tests/test_transcripts.py — Comprehensive tests for audio extraction,
faster-whisper transcription service, job queue handler, and API routes.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.transcript import TranscriptSegment
from app.services.audio_extractor import AudioExtractionError, extract_audio
from app.services.job_queue import job_queue
from app.services.transcription_service import (
    export_srt,
    export_txt,
    export_vtt,
    get_optimal_device_and_compute_type,
    save_transcript_segments,
)


@pytest.fixture
def project_with_video(db_engine, tmp_path: Path):
    """Create a project with an actual dummy video file on disk."""
    video_dir = tmp_path / "projects" / "proj-trans-001"
    video_dir.mkdir(parents=True, exist_ok=True)
    video_file = video_dir / "source.mp4"
    video_file.write_bytes(b"dummy video content")

    with Session(db_engine) as session:
        proj = Project(
            id="proj-trans-001",
            title="Transcription Test Video",
            original_filename="test.mp4",
            file_path=str(video_file),
            file_size_bytes=1024,
            status="ready",
        )
        session.add(proj)
        session.commit()

    return "proj-trans-001", video_file


# ── Audio Extraction Tests ───────────────────────────────────────────────────

def test_extract_audio_missing_input():
    with pytest.raises(FileNotFoundError):
        extract_audio("nonexistent_video.mp4", "output.wav")


def test_extract_audio_command_generation(tmp_path: Path):
    dummy_input = tmp_path / "in.mp4"
    dummy_input.write_bytes(b"data")
    dummy_output = tmp_path / "out.wav"

    mock_process = MagicMock()
    mock_process.returncode = 0

    def fake_run(cmd, **kwargs):
        # Create output file so post-check passes
        dummy_output.write_bytes(b"fake wav")
        return mock_process

    with patch("subprocess.run", side_effect=fake_run) as mock_run:
        result = extract_audio(dummy_input, dummy_output)
        assert result == dummy_output
        assert mock_run.called
        cmd_args = mock_run.call_args[0][0]
        assert "ffmpeg" in cmd_args
        assert "-vn" in cmd_args
        assert "-acodec" in cmd_args
        assert "pcm_s16le" in cmd_args
        assert "16000" in cmd_args
        assert "1" in cmd_args


def test_extract_audio_ffmpeg_error(tmp_path: Path):
    dummy_input = tmp_path / "in.mp4"
    dummy_input.write_bytes(b"data")
    dummy_output = tmp_path / "out.wav"

    mock_process = MagicMock()
    mock_process.returncode = 1
    mock_process.stderr = "Invalid codec error"

    with patch("subprocess.run", return_value=mock_process):
        with pytest.raises(AudioExtractionError) as exc_info:
            extract_audio(dummy_input, dummy_output)
        assert "Invalid codec error" in str(exc_info.value)


# ── Transcription Service & Export Format Tests ──────────────────────────────

def test_optimal_device_detection():
    device, compute_type = get_optimal_device_and_compute_type()
    assert device in ("cuda", "cpu")
    assert compute_type in ("float16", "int8_float16", "int8")


def test_export_srt_and_vtt_and_txt():
    seg1 = TranscriptSegment(
        id="s1",
        project_id="p1",
        segment_index=0,
        start_time=1.5,
        end_time=4.25,
        text="Halo selamat datang di ClipForge.",
    )
    seg2 = TranscriptSegment(
        id="s2",
        project_id="p1",
        segment_index=1,
        start_time=4.5,
        end_time=8.0,
        text="Ini adalah milestone 3 untuk transkripsi audio.",
    )
    segments = [seg1, seg2]

    # SRT
    srt = export_srt(segments)
    assert "1\n00:00:01,500 --> 00:00:04,250" in srt
    assert "Halo selamat datang di ClipForge." in srt
    assert "2\n00:00:04,500 --> 00:00:08,000" in srt

    # VTT
    vtt = export_vtt(segments)
    assert vtt.startswith("WEBVTT")
    assert "00:00:01.500 --> 00:00:04.250" in vtt

    # TXT
    txt = export_txt(segments)
    assert "[00:01 - 00:04] Halo selamat datang di ClipForge." in txt
    assert "[00:04 - 00:08] Ini adalah milestone 3 untuk transkripsi audio." in txt


def test_save_transcript_segments(db_engine):
    with Session(db_engine) as session:
        proj = Project(
            id="proj-db-test",
            title="DB Test",
            original_filename="a.mp4",
            file_path="/tmp/a.mp4",
            file_size_bytes=100,
            status="ready",
        )
        session.add(proj)
        session.commit()

        mock_data = [
            {
                "segment_index": 0,
                "start_time": 0.0,
                "end_time": 2.5,
                "text": "Kalimat pertama",
                "words": [{"word": "Kalimat", "start": 0.0, "end": 1.0, "probability": 0.9}],
            },
            {
                "segment_index": 1,
                "start_time": 2.6,
                "end_time": 5.0,
                "text": "Kalimat kedua",
                "words": [{"word": "kedua", "start": 2.6, "end": 4.5, "probability": 0.85}],
            },
        ]

        saved = save_transcript_segments("proj-db-test", mock_data, session)
        assert len(saved) == 2
        assert saved[0].text == "Kalimat pertama"
        assert saved[1].text == "Kalimat kedua"


# ── Transcripts API Endpoint Tests ───────────────────────────────────────────

def test_transcribe_endpoint_not_found(client: TestClient):
    resp = client.post("/api/projects/unknown-proj-id/transcribe")
    assert resp.status_code == 404


def test_transcribe_endpoint_success(client: TestClient, project_with_video):
    proj_id, _ = project_with_video
    resp = client.post(
        f"/api/projects/{proj_id}/transcribe",
        json={"model_size": "base", "language": "id"},
    )
    assert resp.status_code == 202
    data = resp.json()
    assert data["project_id"] == proj_id
    assert "job_id" in data
    assert data["model_size"] == "base"


def test_get_transcript_empty(client: TestClient, project_with_video):
    proj_id, _ = project_with_video
    resp = client.get(f"/api/projects/{proj_id}/transcript")
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_id"] == proj_id
    assert data["total_segments"] == 0
    assert data["segments"] == []


def test_export_transcript_not_found(client: TestClient, project_with_video):
    proj_id, _ = project_with_video
    resp = client.get(f"/api/projects/{proj_id}/transcript/export?format=srt")
    assert resp.status_code == 404
    assert "Transkrip belum tersedia" in resp.json()["detail"]


# ── Full Transcription Pipeline Test with Mocked WhisperModel ────────────────

def test_transcribe_job_pipeline_mocked(client: TestClient, project_with_video, tmp_path: Path):
    proj_id, video_file = project_with_video
    fake_wav = video_file.parent / "audio.wav"
    fake_wav.write_bytes(b"dummy wav audio")

    # Mock Whisper segment objects
    mock_word = MagicMock()
    mock_word.word = "Halo"
    mock_word.start = 0.5
    mock_word.end = 1.0
    mock_word.probability = 0.95

    mock_seg = MagicMock()
    mock_seg.start = 0.5
    mock_seg.end = 3.5
    mock_seg.text = " Halo dunia ini transkrip uji coba."
    mock_seg.words = [mock_word]

    mock_info = MagicMock()
    mock_info.duration = 4.0

    mock_model = MagicMock()
    mock_model.transcribe.return_value = ([mock_seg], mock_info)

    with patch(
        "app.services.audio_extractor.extract_audio", return_value=fake_wav
    ), patch(
        "app.services.transcription_service.get_whisper_model", return_value=mock_model
    ):
        # 1. Trigger transcription
        resp = client.post(
            f"/api/projects/{proj_id}/transcribe",
            json={"model_size": "base"},
        )
        assert resp.status_code == 202
        job_id = resp.json()["job_id"]

        # 2. Wait for the background queue worker to complete the job
        import time
        job_data = None
        for _ in range(100):
            j_resp = client.get(f"/api/jobs/{job_id}")
            if j_resp.status_code == 200:
                data = j_resp.json()
                if data["status"] in ("completed", "failed", "cancelled"):
                    job_data = data
                    break
            time.sleep(0.05)

    assert job_data is not None
    assert job_data["status"] == "completed"
    assert job_data["progress"] == 100

    # 4. Check project status is updated to 'transcribed'
    proj_resp = client.get(f"/api/projects/{proj_id}")
    assert proj_resp.status_code == 200
    assert proj_resp.json()["status"] == "transcribed"

    # 5. Fetch transcript list
    t_resp = client.get(f"/api/projects/{proj_id}/transcript")
    assert t_resp.status_code == 200
    t_data = t_resp.json()
    assert t_data["total_segments"] == 1
    assert t_data["segments"][0]["text"] == "Halo dunia ini transkrip uji coba."
    assert len(t_data["segments"][0]["words"]) == 1

    # 6. Test exports
    srt_resp = client.get(f"/api/projects/{proj_id}/transcript/export?format=srt")
    assert srt_resp.status_code == 200
    assert "00:00:00,500 --> 00:00:03,500" in srt_resp.text

    vtt_resp = client.get(f"/api/projects/{proj_id}/transcript/export?format=vtt")
    assert vtt_resp.status_code == 200
    assert "WEBVTT" in vtt_resp.text

    txt_resp = client.get(f"/api/projects/{proj_id}/transcript/export?format=txt")
    assert txt_resp.status_code == 200
    assert "[00:00 - 00:03] Halo dunia ini transkrip uji coba." in txt_resp.text
