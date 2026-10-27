"""
tests/test_projects.py — Unit + integration tests for M2 (Media Ingestion).

Tests cover:
  - media_probe._parse_fps()           (pure unit tests, no ffprobe needed)
  - POST /api/projects/upload           (with a synthetic tiny valid mp4)
  - GET  /api/projects                  (list)
  - GET  /api/projects/{id}             (detail)
  - DELETE /api/projects/{id}           (cleanup)
  - Upload with invalid extension       (should 415)

Note: The `client` fixture is provided by conftest.py.
"""
from __future__ import annotations

import io
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services.media_probe import _parse_fps, MediaProbeError, probe


# ── Helpers ───────────────────────────────────────────────────────────────────

FAKE_PROBE_RESULT = {
    "duration": 12.345,
    "width": 1920,
    "height": 1080,
    "fps": 29.97,
    "audio_channels": 2,
}

FAKE_SMALL_VIDEO_BYTES = b"\x00" * 1024  # Not a real video — probe is mocked


# ── Unit tests: _parse_fps ─────────────────────────────────────────────────────

class TestParseFps:
    def test_integer_string(self):
        assert _parse_fps("25") == 25.0

    def test_fraction_ntsc(self):
        result = _parse_fps("30000/1001")
        assert abs(result - 29.97) < 0.01

    def test_fraction_60(self):
        result = _parse_fps("60/1")
        assert result == 60.0

    def test_fraction_cinematic(self):
        result = _parse_fps("24/1")
        assert result == 24.0

    def test_invalid_string(self):
        assert _parse_fps("N/A") == 0.0

    def test_zero_denominator(self):
        assert _parse_fps("0/0") == 0.0

    def test_high_fps(self):
        result = _parse_fps("120/1")
        assert result == 120.0


# ── Unit tests: probe() error handling ────────────────────────────────────────

class TestProbeErrors:
    def test_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            probe("/nonexistent/video.mp4")

    def test_ffprobe_not_on_path(self, tmp_path):
        dummy = tmp_path / "dummy.mp4"
        dummy.write_bytes(b"\x00" * 10)
        with patch("subprocess.run", side_effect=FileNotFoundError("ffprobe")):
            with pytest.raises(MediaProbeError, match="ffprobe executable"):
                probe(dummy)

    def test_ffprobe_non_zero_exit(self, tmp_path):
        dummy = tmp_path / "corrupt.mp4"
        dummy.write_bytes(b"\xff\xfe" * 5)

        import subprocess
        mock_result = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="Invalid data found"
        )
        with patch("subprocess.run", return_value=mock_result):
            with pytest.raises(MediaProbeError, match="non-zero exit code"):
                probe(dummy)


# ── Integration tests: project endpoints ─────────────────────────────────────

class TestProjectEndpoints:

    def _upload(self, client: TestClient) -> dict:
        """Helper: upload a mocked video and return parsed JSON."""
        with patch("app.api.routes.projects.probe", return_value=FAKE_PROBE_RESULT):
            resp = client.post(
                "/api/projects/upload",
                files={"file": ("test_video.mp4", io.BytesIO(FAKE_SMALL_VIDEO_BYTES), "video/mp4")},
            )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_upload_success(self, client):
        data = self._upload(client)
        assert data["project"]["status"] == "ready"
        assert data["project"]["width"] == 1920
        assert data["project"]["height"] == 1080
        assert data["project"]["fps"] == 29.97
        assert data["project"]["audio_channels"] == 2
        assert data["project"]["original_filename"] == "test_video.mp4"

    def test_upload_invalid_extension(self, client):
        resp = client.post(
            "/api/projects/upload",
            files={"file": ("clip.txt", io.BytesIO(b"hello"), "text/plain")},
        )
        assert resp.status_code == 415

    def test_list_projects(self, client):
        self._upload(client)
        self._upload(client)

        resp = client.get("/api/projects")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 2

    def test_get_project_detail(self, client):
        upload_data = self._upload(client)
        pid = upload_data["project"]["id"]

        resp = client.get(f"/api/projects/{pid}")
        assert resp.status_code == 200
        assert resp.json()["id"] == pid

    def test_get_project_not_found(self, client):
        resp = client.get("/api/projects/nonexistent-id-abc")
        assert resp.status_code == 404

    def test_delete_project(self, client):
        upload_data = self._upload(client)
        pid = upload_data["project"]["id"]

        # Delete
        resp = client.delete(f"/api/projects/{pid}")
        assert resp.status_code == 204

        # Should now 404
        resp = client.get(f"/api/projects/{pid}")
        assert resp.status_code == 404

    def test_delete_nonexistent_project(self, client):
        resp = client.delete("/api/projects/does-not-exist")
        assert resp.status_code == 404
