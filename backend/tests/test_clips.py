"""
tests/test_clips.py — Comprehensive tests for AI Clip Finder Service,
Gemini API integration (with mocked responses and fallback),
job queue handler, and REST API endpoints.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.clip import ClipCandidate
from app.models.project import Project
from app.models.transcript import TranscriptSegment
from app.services.clip_finder import (
    _fallback_curate_clips,
    curate_clips_with_gemini,
    save_clip_candidates,
)


@pytest.fixture
def project_with_transcripts(db_engine, tmp_path: Path):
    """Fixture creating a ready project with realistic transcript segments."""
    video_dir = tmp_path / "projects" / "proj-clip-001"
    video_dir.mkdir(parents=True, exist_ok=True)
    video_file = video_dir / "source.mp4"
    video_file.write_bytes(b"dummy clip video content")

    with Session(db_engine) as session:
        proj = Project(
            id="proj-clip-001",
            title="AI Podcast Ep 10",
            original_filename="podcast.mp4",
            file_path=str(video_file),
            file_size_bytes=4096,
            status="transcribed",
        )
        session.add(proj)

        # Add 6 transcript segments spanning 0 to 120 seconds
        segments = [
            TranscriptSegment(
                id="seg-1",
                project_id="proj-clip-001",
                segment_index=0,
                start_time=0.0,
                end_time=15.0,
                text="Selamat datang di podcast kita kali ini kita akan membahas rahasia sukses startup AI.",
            ),
            TranscriptSegment(
                id="seg-2",
                project_id="proj-clip-001",
                segment_index=1,
                start_time=15.0,
                end_time=35.0,
                text="Banyak orang berpikir modal besar adalah segalanya tapi kenyataannya eksekusi cepat yang menentukan.",
            ),
            TranscriptSegment(
                id="seg-3",
                project_id="proj-clip-001",
                segment_index=2,
                start_time=35.0,
                end_time=58.0,
                text="Dalam 3 bulan pertama, Anda harus menguji MVP langsung ke pengguna nyata jangan menunggu sempurna.",
            ),
            TranscriptSegment(
                id="seg-4",
                project_id="proj-clip-001",
                segment_index=3,
                start_time=58.0,
                end_time=75.0,
                text="Kesalahan fatal para founder adalah terlalu jatuh cinta pada produk bukan pada masalah pelanggan.",
            ),
            TranscriptSegment(
                id="seg-5",
                project_id="proj-clip-001",
                segment_index=4,
                start_time=75.0,
                end_time=95.0,
                text="Ketika Anda fokus menyelesaikan masalah riil, monetisasi akan mengalir secara organik.",
            ),
            TranscriptSegment(
                id="seg-6",
                project_id="proj-clip-001",
                segment_index=5,
                start_time=95.0,
                end_time=115.0,
                text="Itulah kesimpulan diskusi kita hari ini, jangan lupa like dan subscribe untuk insight berikutnya.",
            ),
        ]
        session.add_all(segments)
        session.commit()

    return "proj-clip-001"


# ── Unit Tests: Heuristic Fallback Curate ─────────────────────────────────────

def test_fallback_curate_empty_segments():
    results = _fallback_curate_clips([])
    assert results == []


def test_fallback_curate_generates_candidates():
    segments = [
        {"start_time": 0.0, "end_time": 25.0, "text": "Hook pembuka yang sangat menarik dan mengejutkan penonton."},
        {"start_time": 25.0, "end_time": 55.0, "text": "Poin inti dari strategi pemasaran modern tanpa budget iklan."},
        {"start_time": 55.0, "end_time": 90.0, "text": "Studi kasus nyata bagaimana brand bertumbuh 10x dalam 6 bulan."},
    ]
    candidates = _fallback_curate_clips(segments)
    assert len(candidates) >= 1
    for c in candidates:
        assert "title" in c
        assert "hook" in c
        assert "rationale" in c
        assert c["start_time"] < c["end_time"]
        assert 1 <= c["virality_score"] <= 100
        assert c["category"].lower() in ["insight", "actionable", "story", "highlight"]


# ── Unit Tests: Gemini AI Curation & Resilience ──────────────────────────────

def test_curate_clips_without_api_key_uses_fallback():
    segments = [
        {"start_time": 0.0, "end_time": 30.0, "text": "Pertanyaan penting tentang masa depan teknologi AI."},
        {"start_time": 30.0, "end_time": 60.0, "text": "Jawaban mendalam dari para ahli industri kecerdasan buatan."},
    ]
    with patch("app.services.clip_finder.settings.GEMINI_API_KEY", None):
        results = curate_clips_with_gemini(segments, project_title="Test Video")
        assert len(results) >= 1
        assert "title" in results[0]
        assert results[0]["virality_score"] > 0


def test_curate_clips_with_mocked_gemini_success():
    segments = [
        {"start_time": 0.0, "end_time": 30.0, "text": "Intro strategi viral."},
        {"start_time": 30.0, "end_time": 60.0, "text": "Eksekusi hook konten."},
    ]

    mock_gemini_response = {
        "clips": [
            {
                "title": "Rahasia Hook 3 Detik Pertama",
                "hook": "Banyak orang salah bikin hook!",
                "rationale": "Membahas kesalahan umum creator dengan retensi tinggi.",
                "start_time": 0.0,
                "end_time": 32.5,
                "category": "Insight",
                "virality_score": 92,
            },
            {
                "title": "Cara Riset Konten Viral",
                "hook": "Gunakan metode 3 langkah ini.",
                "rationale": "Memberikan panduan teknis yang mudah dipraktekkan.",
                "start_time": 30.0,
                "end_time": 58.0,
                "category": "Actionable",
                "virality_score": 88,
            },
        ]
    }

    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = json.dumps(mock_gemini_response)
    mock_client.models.generate_content.return_value = mock_response

    with patch("app.services.clip_finder.settings.GEMINI_API_KEY", "test-key-abc"):
        with patch("google.genai.Client", return_value=mock_client):
            clips = curate_clips_with_gemini(segments, project_title="Podcast Konten")

    assert len(clips) == 2
    assert clips[0]["title"] == "Rahasia Hook 3 Detik Pertama"
    assert clips[0]["virality_score"] == 92
    assert clips[1]["category"].lower() == "actionable"


def test_curate_clips_gemini_markdown_wrapped_json():
    segments = [{"start_time": 0.0, "end_time": 40.0, "text": "Kiat sukses berbisnis dari nol."}]

    raw_json_str = """```json
    {
        "clips": [
            {
                "title": "Mulai Bisnis Tanpa Modal",
                "hook": "Jangan pinjam uang dulu!",
                "rationale": "Prinsip bootstrap yang efektif.",
                "start_time": 0.0,
                "end_time": 35.0,
                "category": "Story",
                "virality_score": 85
            }
        ]
    }
    ```"""

    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = raw_json_str
    mock_client.models.generate_content.return_value = mock_response

    with patch("app.services.clip_finder.settings.GEMINI_API_KEY", "test-key-abc"):
        with patch("google.genai.Client", return_value=mock_client):
            clips = curate_clips_with_gemini(segments, project_title="Bisnis 101")

    assert len(clips) == 1
    assert clips[0]["title"] == "Mulai Bisnis Tanpa Modal"
    assert clips[0]["virality_score"] == 85


def test_curate_clips_gemini_exception_triggers_fallback():
    segments = [
        {"start_time": 0.0, "end_time": 25.0, "text": "Bagian satu transkrip."},
        {"start_time": 25.0, "end_time": 50.0, "text": "Bagian dua transkrip."},
    ]

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = RuntimeError("Quota exceeded 429")

    with patch("app.services.clip_finder.settings.GEMINI_API_KEY", "test-key-abc"):
        with patch("google.genai.Client", return_value=mock_client):
            clips = curate_clips_with_gemini(segments, project_title="Fallback Test")

    # Should not crash; must return fallback clips
    assert len(clips) >= 1
    assert clips[0]["virality_score"] > 0


# ── Unit Tests: Save Clip Candidates ─────────────────────────────────────────

def test_save_clip_candidates_to_db(db_engine):
    with Session(db_engine) as session:
        proj = Project(
            id="proj-db-clip",
            title="Database Clip Test",
            original_filename="clip_test.mp4",
            file_path="dummy.mp4",
            file_size_bytes=100,
            status="ready",
        )
        session.add(proj)
        session.commit()

        candidates = [
            {
                "title": "Klip DB #1",
                "hook": "Hook DB 1",
                "rationale": "Alasan DB 1",
                "start_time": 10.0,
                "end_time": 40.0,
                "virality_score": 90,
                "category": "Highlight",
            },
            {
                "title": "Klip DB #2",
                "hook": "Hook DB 2",
                "rationale": "Alasan DB 2",
                "start_time": 50.0,
                "end_time": 85.0,
                "virality_score": 75,
                "category": "Insight",
            },
        ]
        saved = save_clip_candidates(project_id="proj-db-clip", clips=candidates, db=session)
        assert len(saved) == 2
        assert saved[0].status == "suggested"
        assert saved[0].project_id == "proj-db-clip"

        # Verify querying from DB
        db_clips = session.query(ClipCandidate).filter_by(project_id="proj-db-clip").all()
        assert len(db_clips) == 2


# ── API Route & Background Job Tests ─────────────────────────────────────────

def test_find_clips_missing_project(client: TestClient):
    resp = client.post("/api/projects/non-existent-id/find-clips")
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_find_clips_no_transcripts(client: TestClient, db_engine):
    with Session(db_engine) as session:
        proj = Project(
            id="proj-no-trans",
            title="No Transcript Proj",
            original_filename="source.mp4",
            file_path="dummy.mp4",
            file_size_bytes=100,
            status="ready",
        )
        session.add(proj)
        session.commit()

    resp = client.post("/api/projects/proj-no-trans/find-clips")
    assert resp.status_code == 400
    assert "transkrip" in resp.json()["detail"].lower()


def test_find_clips_pipeline_and_crud(client: TestClient, project_with_transcripts: str):
    proj_id = project_with_transcripts

    mock_gemini_data = {
        "clips": [
            {
                "title": "Kesalahan Fatal Founder Startup",
                "hook": "Jangan jatuh cinta pada produk!",
                "rationale": "Prinsip bisnis krusial yang mengundang debat dan share.",
                "start_time": 58.0,
                "end_time": 95.0,
                "category": "Insight",
                "virality_score": 95,
            },
            {
                "title": "Uji MVP dalam 3 Bulan",
                "hook": "Jangan tunggu sempurna!",
                "rationale": "Tips eksekusi cepat berbobot tinggi bagi para builder.",
                "start_time": 35.0,
                "end_time": 58.0,
                "category": "Actionable",
                "virality_score": 88,
            },
        ]
    }

    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = json.dumps(mock_gemini_data)
    mock_client.models.generate_content.return_value = mock_response

    with patch("app.services.clip_finder.settings.GEMINI_API_KEY", "mock-key-123"):
        with patch("google.genai.Client", return_value=mock_client):
            # 1. Trigger find clips
            resp = client.post(f"/api/projects/{proj_id}/find-clips")
            assert resp.status_code == 202
            data = resp.json()
            assert "job_id" in data
            job_id = data["job_id"]

            # 2. Wait for background queue worker
            job_data = None
            for _ in range(100):
                j_resp = client.get(f"/api/jobs/{job_id}")
                if j_resp.status_code == 200:
                    d = j_resp.json()
                    if d["status"] in ("completed", "failed", "cancelled"):
                        job_data = d
                        break
                time.sleep(0.05)

    assert job_data is not None
    assert job_data["status"] == "completed"
    assert job_data["progress"] == 100

    # 3. GET /api/projects/{id}/clips
    clips_resp = client.get(f"/api/projects/{proj_id}/clips")
    assert clips_resp.status_code == 200
    clip_list = clips_resp.json()
    assert clip_list["total_clips"] == 2
    assert clip_list["clips"][0]["virality_score"] >= clip_list["clips"][1]["virality_score"]
    assert clip_list["clips"][0]["title"] == "Kesalahan Fatal Founder Startup"
    first_clip_id = clip_list["clips"][0]["id"]

    # 4. PATCH /api/clips/{id} — valid update
    patch_resp = client.patch(
        f"/api/clips/{first_clip_id}",
        json={
            "start_time": 60.0,
            "end_time": 92.0,
            "title": "Kesalahan Fatal Founder (Edited)",
            "status": "approved",
        },
    )
    assert patch_resp.status_code == 200
    updated = patch_resp.json()
    assert updated["start_time"] == 60.0
    assert updated["end_time"] == 92.0
    assert updated["title"] == "Kesalahan Fatal Founder (Edited)"
    assert updated["status"] == "approved"

    # 5. PATCH /api/clips/{id} — invalid trim validation (end <= start)
    invalid_patch = client.patch(
        f"/api/clips/{first_clip_id}",
        json={"start_time": 70.0, "end_time": 65.0},
    )
    assert invalid_patch.status_code == 422
    assert "harus lebih besar" in invalid_patch.json()["detail"].lower()

    # 6. DELETE /api/clips/{id}
    del_resp = client.delete(f"/api/clips/{first_clip_id}")
    assert del_resp.status_code == 204

    # 7. GET after delete should only have 1 clip
    clips_resp_after = client.get(f"/api/projects/{proj_id}/clips")
    assert clips_resp_after.status_code == 200
    assert clips_resp_after.json()["total_clips"] == 1

    # 8. DELETE again should return 404
    del_again = client.delete(f"/api/clips/{first_clip_id}")
    assert del_again.status_code == 404


def test_intro_hook_banner_and_cover_grabber(client: TestClient, project_with_transcripts: str, db_engine):
    """Test intro_hook_banner toggling and POST/GET cover image flow."""
    proj_id = project_with_transcripts

    from sqlalchemy.orm import sessionmaker
    from app.models.clip import ClipCandidate

    TestingSession = sessionmaker(bind=db_engine)
    with TestingSession() as db:
        c = ClipCandidate(
            project_id=proj_id,
            title="Rahasia Monetisasi Startup",
            hook="JANGAN TERLALU JATUH CINTA PADA PRODUK!",
            rationale="High virality hook.",
            start_time=10.0,
            end_time=40.0,
            virality_score=92,
            category="business",
            intro_hook_banner=True,
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        clip_id = c.id

    assert c.intro_hook_banner is True

    # 1. Update intro_hook_banner via PATCH
    patch_resp = client.patch(
        f"/api/clips/{clip_id}",
        json={"intro_hook_banner": False},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["intro_hook_banner"] is False

    # 2. GET cover before generating -> 404
    cov_resp_404 = client.get(f"/api/clips/{clip_id}/cover")
    assert cov_resp_404.status_code == 404

    # 3. POST generate-cover with mocked ffmpeg
    def fake_ffmpeg_run(cmd, *args, **kwargs):
        out_file = Path(cmd[-1])
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_bytes(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00dummy_cover_bytes")
        res = MagicMock()
        res.returncode = 0
        res.stdout = ""
        res.stderr = ""
        return res

    with patch("app.api.routes.clips.subprocess.run", side_effect=fake_ffmpeg_run):
        gen_resp = client.post(f"/api/clips/{clip_id}/generate-cover")
        assert gen_resp.status_code == 200
        assert gen_resp.headers["content-type"].startswith("image/jpeg")
        assert gen_resp.content.startswith(b"\xff\xd8\xff\xe0")

    # 4. GET cover after generation -> 200
    cov_resp_200 = client.get(f"/api/clips/{clip_id}/cover")
    assert cov_resp_200.status_code == 200
    assert cov_resp_200.headers["content-type"].startswith("image/jpeg")
    assert cov_resp_200.content.startswith(b"\xff\xd8\xff\xe0")


def test_generate_and_get_social_copy(client: TestClient, project_with_transcripts: str, db_engine):
    proj_id = project_with_transcripts

    from sqlalchemy.orm import sessionmaker
    from app.models.clip import ClipCandidate

    TestingSession = sessionmaker(bind=db_engine)
    with TestingSession() as db:
        c = ClipCandidate(
            project_id=proj_id,
            title="Trik Rahasia Sukses Usaha Startup",
            hook="Jangan pernah buat produk sebelum punya pembeli!",
            rationale="Momen actionable bernilai tinggi.",
            start_time=10.0,
            end_time=35.0,
            category="Insight",
            virality_score=92,
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        clip_id = c.id

    # 1. POST generate-social-copy with 'all' platforms (algorithmic fallback)
    with patch("app.services.social_copywriter.settings.GEMINI_API_KEY", None):
        resp = client.post(
            f"/api/clips/{clip_id}/generate-social-copy",
            json={"platform": "all", "custom_topic": "entrepreneur"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["clip_id"] == clip_id
        assert "tiktok" in data["copies"]
        assert "shorts" in data["copies"]
        assert "reels" in data["copies"]

        tt = data["copies"]["tiktok"]
        assert "hook" in tt and len(tt["hook"]) > 0
        assert "caption" in tt and len(tt["caption"]) <= 150
        assert len(tt["hashtags"]) == 4
        assert "#fyp" in tt["hashtags"]
        assert "full_formatted_text" in tt
        assert tt["cta"] in tt["full_formatted_text"]

        sh = data["copies"]["shorts"]
        assert len(sh["title"]) <= 60
        assert "#Shorts" in sh["hashtags"]

        reels = data["copies"]["reels"]
        assert len(reels["hashtags"]) == 5
        assert "Follow" in reels["cta"]

        # 2. GET social-copy returns cached copy
        get_resp = client.get(f"/api/clips/{clip_id}/social-copy")
        assert get_resp.status_code == 200
        get_data = get_resp.json()
        assert get_data["copies"]["tiktok"]["caption"] == tt["caption"]

        # 3. Regenerate single platform (tiktok only)
        single_resp = client.post(
            f"/api/clips/{clip_id}/generate-social-copy",
            json={"platform": "tiktok"},
        )
        assert single_resp.status_code == 200
        assert "tiktok" in single_resp.json()["copies"]


def test_generate_social_copy_gemini_mock(client: TestClient, project_with_transcripts: str, db_engine):
    from sqlalchemy.orm import sessionmaker
    from app.models.clip import ClipCandidate

    TestingSession = sessionmaker(bind=db_engine)
    with TestingSession() as db:
        c = ClipCandidate(
            project_id=project_with_transcripts,
            title="Cara Cepat Monetisasi Podcast",
            hook="Dapat sponsor pertama cuma modal 1000 views!",
            rationale="Tips menghasilkan uang dari konten.",
            start_time=5.0,
            end_time=30.0,
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        clip_id = c.id

    gemini_output = {
        "tiktok": {
            "title": "Monetisasi Podcast Kilat",
            "hook": "Banyak yang gak tahu rahasia sponsor ini...",
            "caption": "Modal 1000 views udah bisa dapet cuan? Tonton sampai habis!",
            "hashtags": ["#podcast", "#cuan", "#tipsbisnis", "#fyp"],
            "cta": "Kalian udah pernah coba cara ini belum? Komen di bawah!",
        },
        "shorts": {
            "title": "Trik Dapat Sponsor Podcast Pertama",
            "hook": "Cara monetize podcast modal kecil",
            "caption": "Panduan langkah demi langkah mendapatkan sponsor untuk podcaster pemula.",
            "hashtags": ["#Shorts", "#Podcasting", "#TipsKreator"],
            "cta": "Subscribe untuk tips konten kreator lainnya!",
        },
        "reels": {
            "title": "Strategi Monetisasi Podcast",
            "hook": "✨ Rahasia cuan dari podcast pemula",
            "caption": "Banyak kreator salah fokus di jumlah subscriber...\n\nPadahal engagement adalah kunci utama brand mau bayar kamu.\n\nSave reels ini biar gak lupa!",
            "hashtags": ["#reelsindonesia", "#kontenkreator", "#bisnisdigital", "#podcastindonesia", "#monetisasi"],
            "cta": "Follow akun ini untuk panduan kreator harian!",
        },
    }

    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = json.dumps(gemini_output)
    mock_client.models.generate_content.return_value = mock_response

    with patch("app.services.social_copywriter.settings.GEMINI_API_KEY", "mock-gemini-key"):
        with patch("google.genai.Client", return_value=mock_client):
            resp = client.post(
                f"/api/clips/{clip_id}/generate-social-copy",
                json={"platform": "all"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["copies"]["tiktok"]["caption"] == gemini_output["tiktok"]["caption"]
            assert data["copies"]["shorts"]["title"] == gemini_output["shorts"]["title"]


def test_download_export_kit_zip(client: TestClient, project_with_transcripts: str, tmp_path: Path, db_engine):
    from sqlalchemy.orm import sessionmaker
    from app.models.clip import ClipCandidate
    import zipfile
    import io

    TestingSession = sessionmaker(bind=db_engine)
    with TestingSession() as db:
        c = ClipCandidate(
            project_id=project_with_transcripts,
            title="Momen Epik Turnamen Game",
            hook="Clutch 1 lawan 4 paling gila!",
            rationale="Aksi menegangkan.",
            start_time=20.0,
            end_time=45.0,
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        clip_id = c.id

    # 1. GET export-kit before rendering video -> 400
    fail_resp = client.get(f"/api/clips/{clip_id}/export-kit")
    assert fail_resp.status_code == 400
    assert "belum dirender" in fail_resp.json()["detail"].lower()

    # 2. Create dummy rendered MP4 and cover JPG on disk
    dummy_mp4 = tmp_path / "dummy_render.mp4"
    dummy_mp4.write_bytes(b"\x00\x00\x00\x20ftypmp42fake_mp4_bytes")

    dummy_cover = tmp_path / "dummy_cover.jpg"
    dummy_cover.write_bytes(b"\xff\xd8\xff\xe0\x00\x10JFIFfake_cover_bytes")

    with TestingSession() as db:
        c_db = db.get(ClipCandidate, clip_id)
        assert c_db is not None
        c_db.rendered_file_path = str(dummy_mp4)
        c_db.cover_file_path = str(dummy_cover)
        db.commit()

    # 3. GET export-kit -> 200 application/zip
    with patch("app.services.social_copywriter.settings.GEMINI_API_KEY", None):
        zip_resp = client.get(f"/api/clips/{clip_id}/export-kit")
        if zip_resp.status_code != 200:
            print("ERROR RESPONSE:", zip_resp.status_code, zip_resp.text)
        assert zip_resp.status_code == 200
        assert zip_resp.headers["content-type"] == "application/zip"
        assert "attachment; filename=" in zip_resp.headers.get("content-disposition", "")

    # 4. Verify ZIP content integrity
    zip_bytes = io.BytesIO(zip_resp.content)
    with zipfile.ZipFile(zip_bytes, "r") as zf:
        namelist = zf.namelist()
        assert any(name.endswith(".mp4") for name in namelist)
        assert any(name.endswith(".jpg") for name in namelist)
        assert any(name.endswith("_social_copy.txt") for name in namelist)

        # Inspect social copy text inside zip
        copy_filename = [n for n in namelist if n.endswith("_social_copy.txt")][0]
        copy_content = zf.read(copy_filename).decode("utf-8")
        assert "CLIPPERFORGE 1-CLICK PUBLISHING KIT" in copy_content
        assert "[1] TIKTOK POSTING KIT" in copy_content
        assert "[2] YOUTUBE SHORTS POSTING KIT" in copy_content
        assert "[3] INSTAGRAM REELS POSTING KIT" in copy_content


def test_create_manual_clip(client: TestClient, project_with_transcripts: str):
    """Test manual clip creation for CapCut-style timeline editing."""
    resp = client.post(
        f"/api/projects/{project_with_transcripts}/clips/manual",
        json={
            "title": "Potongan Manual CapCut",
            "start_time": 5.0,
            "end_time": 25.0,
            "aspect_ratio": "9:16",
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Potongan Manual CapCut"
    assert data["start_time"] == 5.0
    assert data["end_time"] == 25.0
    assert data["category"] == "manual"
    assert data["project_id"] == project_with_transcripts



