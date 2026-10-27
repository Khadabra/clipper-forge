"""
tests/test_youtube.py — Unit and integration tests for YouTube ingestion service & endpoint.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.job import Job
from app.models.project import Project
from app.services.job_queue import job_queue
from app.services.youtube_downloader import (
    is_valid_youtube_url,
    extract_video_id,
)


# ── URL Validation Unit Tests ─────────────────────────────────────────────────

@pytest.mark.parametrize(
    "url,valid",
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", True),
        ("http://youtube.com/watch?v=dQw4w9WgXcQ", True),
        ("https://youtu.be/dQw4w9WgXcQ", True),
        ("https://www.youtube.com/shorts/dQw4w9WgXcQ", True),
        ("https://youtube.com/live/dQw4w9WgXcQ", True),
        ("https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share", True),
        ("https://vimeo.com/12345678", False),
        ("https://google.com", False),
        ("not_a_url", False),
        ("", False),
    ],
)
def test_is_valid_youtube_url(url: str, valid: bool):
    assert is_valid_youtube_url(url) is valid


def test_extract_video_id():
    assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://invalid.com") is None


# ── API Endpoint Tests ────────────────────────────────────────────────────────

def test_youtube_endpoint_invalid_url(client: TestClient):
    response = client.post(
        "/api/projects/youtube",
        json={"url": "https://notyoutube.com/video"},
    )
    assert response.status_code == 400
    assert "URL YouTube tidak valid" in response.json()["detail"]


def test_youtube_endpoint_success(client: TestClient):
    url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    response = client.post(
        "/api/projects/youtube",
        json={"url": url},
    )
    assert response.status_code == 201
    data = response.json()
    assert "project_id" in data
    assert "job_id" in data
    assert data["project"]["status"] == "downloading"
    assert data["project"]["source_url"] == url


# ── Job Execution Pipeline Test (Mocked yt-dlp) ───────────────────────────────

def test_youtube_download_job_pipeline(client: TestClient, tmp_path: Path):
    url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

    # Create dummy downloaded mp4 file
    fake_video = tmp_path / "mock_source.mp4"
    fake_video.write_bytes(b"dummy mp4 video bytes")

    mock_meta = {
        "title": "Rick Astley - Never Gonna Give You Up",
        "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        "duration": 212.0,
    }

    mock_probe = {
        "duration": 212.0,
        "width": 1920,
        "height": 1080,
        "fps": 30.0,
        "audio_channels": 2,
        "file_size_bytes": 1024,
    }

    with patch(
        "app.services.youtube_downloader.get_youtube_metadata", return_value=mock_meta
    ), patch(
        "app.services.youtube_downloader.download_youtube_video", return_value=fake_video
    ), patch(
        "app.services.media_probe.probe", return_value=mock_probe
    ):
        resp = client.post("/api/projects/youtube", json={"url": url})
        assert resp.status_code == 201
        job_id = resp.json()["job_id"]
        project_id = resp.json()["project_id"]

        import time
        for _ in range(100):
            j_resp = client.get(f"/api/jobs/{job_id}")
            if j_resp.status_code == 200 and j_resp.json()["status"] in ("completed", "failed", "cancelled"):
                break
            time.sleep(0.05)

        # Verify Job completed
        job_resp = client.get(f"/api/jobs/{job_id}")
        assert job_resp.status_code == 200
        assert job_resp.json()["status"] == "completed"
        assert job_resp.json()["progress"] == 100

        # Verify Project was updated with title and probed metadata
        proj_resp = client.get(f"/api/projects/{project_id}")
        assert proj_resp.status_code == 200
        pdata = proj_resp.json()
        assert pdata["status"] == "ready"
        assert pdata["title"] == "Rick Astley - Never Gonna Give You Up"
        assert pdata["thumbnail_url"] == "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
        assert pdata["width"] == 1920
        assert pdata["height"] == 1080
        assert pdata["fps"] == 30.0


def test_youtube_download_job_failure_handling(client: TestClient):
    url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

    with patch(
        "app.services.youtube_downloader.get_youtube_metadata",
        side_effect=Exception("Video is private or unavailable"),
    ), patch(
        "app.services.youtube_downloader.download_youtube_video",
        side_effect=Exception("yt-dlp download failed"),
    ):
        resp = client.post("/api/projects/youtube", json={"url": url})
        job_id = resp.json()["job_id"]
        project_id = resp.json()["project_id"]

        import time
        for _ in range(100):
            j_resp = client.get(f"/api/jobs/{job_id}")
            if j_resp.status_code == 200 and j_resp.json()["status"] in ("completed", "failed", "cancelled"):
                break
            time.sleep(0.05)

        # Verify Job is marked failed
        job_resp = client.get(f"/api/jobs/{job_id}")
        assert job_resp.status_code == 200
        assert job_resp.json()["status"] == "failed"
        assert "download failed" in job_resp.json()["error_message"]

        # Verify Project status is marked failed
        proj_resp = client.get(f"/api/projects/{project_id}")
        assert proj_resp.status_code == 200
        assert proj_resp.json()["status"] == "failed"

