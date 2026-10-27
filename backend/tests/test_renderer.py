"""
tests/test_renderer.py — Unit and integration tests for Subtitle Burner,
Video Renderer engine, and Clip Export Render API pipeline.
"""
from __future__ import annotations

import json
from pathlib import Path
import time
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.clip import ClipCandidate
from app.models.project import Project
from app.models.transcript import TranscriptSegment
from app.services.subtitle_burner import (
    create_clip_subtitle_file,
    escape_ffmpeg_filter_path,
    format_ass_time,
    generate_ass_subtitle_content,
    resolve_clip_segments,
)
from app.services.video_renderer import (
    build_filter_graph,
    get_target_dimensions,
    render_video_clip,
)


# ── Subtitle Burner Unit Tests ───────────────────────────────────────────────

def test_format_ass_time():
    assert format_ass_time(0.0) == "0:00:00.00"
    assert format_ass_time(1.5) == "0:00:01.50"
    assert format_ass_time(65.25) == "0:01:05.25"
    assert format_ass_time(3661.12) == "1:01:01.12"


def test_escape_ffmpeg_filter_path():
    path = Path("C:/storage/exports/sub.ass")
    escaped = escape_ffmpeg_filter_path(path)
    assert "\\:" in escaped
    assert "/" in escaped


def test_generate_ass_subtitle_content_clean_preset():
    segments = [
        {"start_time": 10.0, "end_time": 15.0, "text": "Kalimat pertama dalam klip."},
        {"start_time": 15.0, "end_time": 22.0, "text": "Kalimat kedua yang sangat menarik."},
    ]
    # Clip from 10.0 to 25.0 -> rel start of seg 1 should be 0:00:00.00
    content = generate_ass_subtitle_content(
        segments=segments,
        clip_start=10.0,
        clip_end=25.0,
        subtitle_style="condensed_clean",
        play_res_x=1080,
        play_res_y=1920,
    )
    assert content is not None
    assert "[Script Info]" in content
    assert "[V4+ Styles]" in content
    assert "PlayResX: 1080" in content
    assert "PlayResY: 1920" in content
    assert "Bahnschrift" in content
    assert "&H00FFFFFF" in content  # Crisp white
    assert "Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Kalimat pertama dalam klip." in content
    assert "Dialogue: 0,0:00:05.00,0:00:12.00,Default,,0,0,0,,Kalimat kedua yang sangat menarik." in content


def test_generate_ass_subtitle_content_bold_yellow_preset():
    segments = [
        {"start_time": 0.0, "end_time": 5.0, "text": "Rahasia sukses founder startup."},
    ]
    content = generate_ass_subtitle_content(
        segments=segments,
        clip_start=0.0,
        clip_end=5.0,
        subtitle_style="hormozi",
    )
    assert content is not None
    assert "Impact" in content
    assert "&H0000E5FF" in content  # Yellow primary color
    assert "RAHASIA SUKSES FOUNDER STARTUP." in content  # Uppercase


def test_generate_ass_subtitle_none():
    segments = [{"start_time": 0.0, "end_time": 5.0, "text": "Subtitle ignored."}]
    content = generate_ass_subtitle_content(
        segments=segments,
        clip_start=0.0,
        clip_end=5.0,
        subtitle_style="none",
    )
    assert content is None


def test_create_clip_subtitle_file(tmp_path: Path):
    segments = [{"start_time": 5.0, "end_time": 10.0, "text": "Tes simpan file ASS."}]
    out_file = tmp_path / "sub.ass"
    res = create_clip_subtitle_file(
        segments=segments,
        clip_start=5.0,
        clip_end=10.0,
        output_path=out_file,
    )
    assert res == out_file
    assert out_file.exists()
    assert "Tes simpan file ASS." in out_file.read_text(encoding="utf-8")


# ── Video Renderer Unit Tests ────────────────────────────────────────────────

def test_get_target_dimensions():
    assert get_target_dimensions("9:16") == (1080, 1920)
    assert get_target_dimensions("1:1") == (1080, 1080)
    assert get_target_dimensions("16:9") == (1920, 1080)


def test_build_filter_graph_blur_fill():
    fg, label = build_filter_graph(aspect_ratio="9:16", crop_mode="blur_fill")
    assert "split=2" in fg
    assert "boxblur" in fg
    assert "overlay" in fg
    assert label == "[v_composed]"


def test_build_filter_graph_center_crop():
    fg, label = build_filter_graph(aspect_ratio="9:16", crop_mode="center_crop")
    assert "crop=1080:1920" in fg
    assert label == "[v_cropped]"


def test_build_filter_graph_with_subtitles(tmp_path: Path):
    fake_ass = tmp_path / "test.ass"
    fake_ass.write_text("dummy ass")
    fg, label = build_filter_graph(
        aspect_ratio="9:16",
        crop_mode="center_crop",
        ass_sub_path=fake_ass,
    )
    assert "ass=" in fg
    assert label == "[v_out]"


def test_render_video_clip_missing_input(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        render_video_clip(
            source_video_path=tmp_path / "missing.mp4",
            output_path=tmp_path / "out.mp4",
            start_time=0.0,
            end_time=10.0,
        )


def test_render_video_clip_mocked_execution(tmp_path: Path):
    source = tmp_path / "src.mp4"
    source.write_bytes(b"dummy mp4")
    dest = tmp_path / "out.mp4"

    progress_vals = []

    def mock_progress(val: int):
        progress_vals.append(val)

    mock_proc = MagicMock()
    mock_proc.poll.return_value = 0
    mock_proc.returncode = 0
    mock_proc.communicate.return_value = ("", "")

    def fake_popen(cmd, **kwargs):
        # Create output file so post-check succeeds
        dest.write_bytes(b"rendered mp4 content")
        return mock_proc

    with patch("subprocess.Popen", side_effect=fake_popen) as popen_mock:
        rendered = render_video_clip(
            source_video_path=source,
            output_path=dest,
            start_time=10.0,
            end_time=30.0,
            aspect_ratio="9:16",
            crop_mode="blur_fill",
            subtitle_style="none",
            set_progress=mock_progress,
        )
        assert rendered == dest
        assert popen_mock.called
        cmd_args = popen_mock.call_args[0][0]
        assert "ffmpeg" in cmd_args
        assert "-ss" in cmd_args
        assert "-to" in cmd_args
        assert 100 in progress_vals


# ── Integration Tests: Render Pipeline & Download Endpoint ───────────────────

@pytest.fixture
def project_with_clip(db_engine, tmp_path: Path):
    video_dir = tmp_path / "projects" / "proj-render-001"
    video_dir.mkdir(parents=True, exist_ok=True)
    video_file = video_dir / "source.mp4"
    video_file.write_bytes(b"dummy project video content")

    with Session(db_engine) as session:
        proj = Project(
            id="proj-render-001",
            title="Shorts Creator Video",
            original_filename="creator.mp4",
            file_path=str(video_file),
            file_size_bytes=2048,
            status="clips_ready",
        )
        session.add(proj)

        clip = ClipCandidate(
            id="clip-render-001",
            project_id="proj-render-001",
            title="Cara Cepat Bikin Konten",
            hook="Trik 5 menit bikin konten!",
            rationale="Hook sangat kuat dan langsung ke inti.",
            start_time=15.0,
            end_time=45.0,
            virality_score=94,
            category="tutorial",
            status="approved",
            aspect_ratio="9:16",
            subtitle_style="condensed_clean",
            crop_mode="blur_fill",
            render_status="idle",
        )
        session.add(clip)

        seg = TranscriptSegment(
            id="seg-render-1",
            project_id="proj-render-001",
            segment_index=0,
            start_time=15.0,
            end_time=45.0,
            text="Gunakan tiga langkah praktis ini untuk membuat video pendek setiap hari.",
        )
        session.add(seg)
        session.commit()

    return "clip-render-001", "proj-render-001", video_file


def test_trigger_render_missing_clip(client: TestClient):
    resp = client.post("/api/clips/non-existent-clip/render", json={})
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_download_clip_not_rendered_yet(client: TestClient, project_with_clip):
    clip_id, _, _ = project_with_clip
    resp = client.get(f"/api/clips/{clip_id}/download")
    assert resp.status_code == 404
    assert "belum selesai" in resp.json()["detail"].lower()


def test_render_clip_pipeline_and_download(client: TestClient, project_with_clip, tmp_path: Path):
    clip_id, proj_id, source_file = project_with_clip
    fake_output_mp4 = tmp_path / "exports" / f"clip_{clip_id}.mp4"

    def fake_render(*args, **kwargs):
        out_p = kwargs.get("output_path") or (args[1] if len(args) > 1 else fake_output_mp4)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        out_p.write_bytes(b"final rendered 9:16 video content")
        if "set_progress" in kwargs and kwargs["set_progress"]:
            kwargs["set_progress"](100)
        return out_p

    with patch("app.services.video_renderer.render_video_clip", side_effect=fake_render):
        # 1. Trigger render endpoint
        resp = client.post(
            f"/api/clips/{clip_id}/render",
            json={
                "aspect_ratio": "9:16",
                "subtitle_style": "hormozi",
                "crop_mode": "blur_fill",
            },
        )
        assert resp.status_code == 202
        data = resp.json()
        assert data["clip_id"] == clip_id
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

    # 3. Check clip updated in database
    clips_resp = client.get(f"/api/projects/{proj_id}/clips")
    assert clips_resp.status_code == 200
    clip_item = next(c for c in clips_resp.json()["clips"] if c["id"] == clip_id)
    assert clip_item["render_status"] == "completed"
    assert clip_item["subtitle_style"] == "hormozi"
    assert clip_item["crop_mode"] == "blur_fill"
    assert clip_item["rendered_file_path"] is not None

    # 4. Download rendered clip
    down_resp = client.get(f"/api/clips/{clip_id}/download")
    assert down_resp.status_code == 200
    assert down_resp.headers["content-type"] == "video/mp4"
    assert len(down_resp.content) > 0


# ── Milestone 6: Dynamic Auto-Zoom & Interactive Studio Tests ────────────────

def test_build_filter_graph_auto_zoom_subtle():
    fg, label = build_filter_graph(
        aspect_ratio="9:16",
        crop_mode="blur_fill",
        auto_zoom="subtle",
    )
    assert "scale=w='2*trunc(1080*(1+0.12*" in fg
    assert "crop=1080:1920" in fg
    assert label == "[v_zoomed]"


def test_build_filter_graph_auto_zoom_punchy_center_crop():
    fg, label = build_filter_graph(
        aspect_ratio="9:16",
        crop_mode="center_crop",
        auto_zoom="punchy",
    )
    assert "[v_base]" in fg
    assert "scale=w='2*trunc(1080*(1+0.2*" in fg
    assert label == "[v_zoomed]"


def test_build_filter_graph_auto_zoom_with_subtitles(tmp_path: Path):
    fake_ass = tmp_path / "sub_zoom.ass"
    fake_ass.write_text("dummy ass")
    fg, label = build_filter_graph(
        aspect_ratio="9:16",
        crop_mode="blur_fill",
        ass_sub_path=fake_ass,
        auto_zoom="subtle",
    )
    # The subtitle filter must take [v_zoomed] as input so subtitles stay in foreground
    assert "[v_zoomed]ass=" in fg
    assert label == "[v_out]"


def test_custom_transcript_override_subtitle_burner(tmp_path: Path):
    orig_segments = [
        {"start_time": 10.0, "end_time": 20.0, "text": "Teks asli sebelum diedit."}
    ]
    custom_json = json.dumps([
        {"start_time": 10.0, "end_time": 20.0, "text": "Teks kustom hasil perbaikan studio."}
    ])

    resolved = resolve_clip_segments(orig_segments, custom_transcript_json=custom_json)
    assert len(resolved) == 1
    assert resolved[0]["text"] == "Teks kustom hasil perbaikan studio."

    out_file = tmp_path / "custom.ass"
    res = create_clip_subtitle_file(
        segments=orig_segments,
        clip_start=10.0,
        clip_end=20.0,
        output_path=out_file,
        subtitle_style="condensed_clean",
        custom_transcript_json=custom_json,
    )
    assert res == out_file
    content = out_file.read_text(encoding="utf-8")
    assert "Teks kustom hasil perbaikan studio." in content
    assert "Teks asli sebelum diedit." not in content


def test_clip_transcript_crud_and_render_with_auto_zoom(
    client: TestClient, project_with_clip, tmp_path: Path
):
    clip_id, proj_id, _ = project_with_clip

    # 1. GET transcript for clip (should fallback to overlapping project segments)
    get_resp = client.get(f"/api/clips/{clip_id}/transcript")
    assert get_resp.status_code == 200
    segs = get_resp.json()
    assert len(segs) >= 1
    assert "tiga langkah praktis" in segs[0]["text"].lower()

    # 2. PUT edited transcript segments
    updated_segs = [
        {
            "start_time": 15.0,
            "end_time": 30.0,
            "text": "Langkah pertama: Temukan hook yang sangat tajam dan kuat.",
        },
        {
            "start_time": 30.0,
            "end_time": 45.0,
            "text": "Langkah kedua: Gunakan efek Dynamic Auto-Zoom dan visual bersih.",
        },
    ]
    put_resp = client.put(f"/api/clips/{clip_id}/transcript", json=updated_segs)
    assert put_resp.status_code == 200
    clip_data = put_resp.json()
    assert clip_data["custom_transcript_json"] is not None

    # Verify GET returns the newly saved custom segments
    get_updated = client.get(f"/api/clips/{clip_id}/transcript")
    assert get_updated.status_code == 200
    retrieved = get_updated.json()
    assert len(retrieved) == 2
    assert "Langkah pertama:" in retrieved[0]["text"]
    assert "Dynamic Auto-Zoom" in retrieved[1]["text"]

    # 3. Trigger render with auto_zoom='snap_hook'
    fake_output_mp4 = tmp_path / "exports" / f"clip_{clip_id}.mp4"
    called_kwargs = {}

    def fake_render(*args, **kwargs):
        called_kwargs.update(kwargs)
        fake_output_mp4.parent.mkdir(parents=True, exist_ok=True)
        fake_output_mp4.write_bytes(b"rendered video with auto zoom")
        if "set_progress" in kwargs and kwargs["set_progress"]:
            kwargs["set_progress"](100)
        return fake_output_mp4

    with patch("app.services.video_renderer.render_video_clip", side_effect=fake_render):
        r_resp = client.post(
            f"/api/clips/{clip_id}/render",
            json={
                "aspect_ratio": "9:16",
                "subtitle_style": "condensed_clean",
                "crop_mode": "blur_fill",
                "auto_zoom": "snap_hook",
            },
        )
        assert r_resp.status_code == 202
        job_id = r_resp.json()["job_id"]

        for _ in range(100):
            j_resp = client.get(f"/api/jobs/{job_id}")
            if j_resp.status_code == 200 and j_resp.json()["status"] in ("completed", "failed"):
                break
            time.sleep(0.05)

    assert called_kwargs.get("auto_zoom") == "snap_hook"
    assert called_kwargs.get("custom_transcript_json") is not None
    assert "Dynamic Auto-Zoom" in called_kwargs["custom_transcript_json"]


# ── Curated Visual & Subtitle Preset Tests ────────────────────────────────────

def test_build_filter_graph_framed_headline():
    fg, label = build_filter_graph(aspect_ratio="9:16", crop_mode="framed_headline")
    assert "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" in fg
    assert label == "[v_framed]"


def test_build_filter_graph_snap_hook():
    fg, label = build_filter_graph(aspect_ratio="9:16", auto_zoom="snap_hook")
    assert "if(lte(t,3),1.20,1.00)" in fg
    assert label == "[v_zoomed]"


def test_generate_ass_subtitle_boxed_vox():
    segments = [{"start_time": 0.0, "end_time": 4.0, "text": "Investigasi mendalam ala Vox."}]
    content = generate_ass_subtitle_content(
        segments=segments,
        clip_start=0.0,
        clip_end=4.0,
        subtitle_style="boxed_vox",
    )
    assert content is not None
    assert "Segoe UI Black" in content
    assert ",3," in content  # BorderStyle 3 (Boxed)
    assert "&H90141414" in content  # Semi-transparent dark charcoal box
    assert "Investigasi mendalam ala Vox." in content


def test_generate_ass_subtitle_cyber_neon():
    segments = [{"start_time": 0.0, "end_time": 4.0, "text": "Next level cyber gaming."}]
    content = generate_ass_subtitle_content(
        segments=segments,
        clip_start=0.0,
        clip_end=4.0,
        subtitle_style="cyber_neon",
    )
    assert content is not None
    assert "Impact" in content
    assert "&H00FFFF00" in content  # Cyan primary
    assert "&H00D000A0" in content  # Magenta outline
    assert "NEXT LEVEL CYBER GAMING." in content  # Uppercase tech/gaming typography


def test_generate_ass_subtitle_legacy_aliases():
    segments = [{"start_time": 0.0, "end_time": 4.0, "text": "Fallback test."}]
    # Legacy 'clean' maps to condensed_clean
    content_clean = generate_ass_subtitle_content(
        segments=segments, clip_start=0.0, clip_end=4.0, subtitle_style="clean"
    )
    assert content_clean is not None
    assert "Bahnschrift" in content_clean

    # Legacy 'bold_yellow' and 'red_punch' map to hormozi
    content_yellow = generate_ass_subtitle_content(
        segments=segments, clip_start=0.0, clip_end=4.0, subtitle_style="bold_yellow"
    )
    assert content_yellow is not None
    assert "Impact" in content_yellow
    assert "&H0000E5FF" in content_yellow

    # Legacy 'boxed_editorial' maps to boxed_vox
    content_boxed = generate_ass_subtitle_content(
        segments=segments, clip_start=0.0, clip_end=4.0, subtitle_style="boxed_editorial"
    )
    assert content_boxed is not None
    assert "Segoe UI Black" in content_boxed


def test_generate_ass_subtitle_word_highlight_karaoke():
    segments = [
        {
            "start_time": 0.0,
            "end_time": 3.0,
            "text": "Trik rahasia viral.",
            "words": [
                {"word": "Trik", "start": 0.0, "end": 1.0},
                {"word": "rahasia", "start": 1.0, "end": 2.0},
                {"word": "viral.", "start": 2.0, "end": 3.0},
            ],
        }
    ]
    content = generate_ass_subtitle_content(
        segments=segments,
        clip_start=0.0,
        clip_end=3.0,
        subtitle_style="word_highlight",
    )
    assert content is not None
    assert "Impact" in content
    assert r"{\kf" in content
    assert "&H0000E5FF" in content  # Gold highlight secondary color


def test_generate_ass_subtitle_framed_headline_banner():
    segments = [{"start_time": 0.0, "end_time": 4.0, "text": "Isi penjelasan klip."}]
    content = generate_ass_subtitle_content(
        segments=segments,
        clip_start=0.0,
        clip_end=4.0,
        subtitle_style="condensed_clean",
        headline_text="HOOK UTAMA: JANGAN LEWATKAN INI!",
    )
    assert content is not None
    assert "Style: Headline" in content
    assert ",8,40,40,130,1" in content  # Alignment=8 (top-center)
    assert "HOOK UTAMA: JANGAN LEWATKAN INI!" in content


def test_trigger_render_with_new_visual_variants(
    client: TestClient, project_with_clip, tmp_path: Path
):
    clip_id, proj_id, _ = project_with_clip
    fake_output_mp4 = tmp_path / "exports" / f"clip_{clip_id}.mp4"
    called_kwargs = {}

    def fake_render(*args, **kwargs):
        called_kwargs.update(kwargs)
        fake_output_mp4.parent.mkdir(parents=True, exist_ok=True)
        fake_output_mp4.write_bytes(b"rendered video with new visual options")
        if "set_progress" in kwargs and kwargs["set_progress"]:
            kwargs["set_progress"](100)
        return fake_output_mp4

    with patch("app.services.video_renderer.render_video_clip", side_effect=fake_render):
        r_resp = client.post(
            f"/api/clips/{clip_id}/render",
            json={
                "aspect_ratio": "9:16",
                "subtitle_style": "cyber_neon",
                "crop_mode": "framed_headline",
                "auto_zoom": "snap_hook",
            },
        )
        assert r_resp.status_code == 202
        job_id = r_resp.json()["job_id"]

        for _ in range(100):
            j_resp = client.get(f"/api/jobs/{job_id}")
            if j_resp.status_code == 200 and j_resp.json()["status"] in ("completed", "failed"):
                break
            time.sleep(0.05)

    assert called_kwargs.get("crop_mode") == "framed_headline"
    assert called_kwargs.get("subtitle_style") == "cyber_neon"
    assert called_kwargs.get("auto_zoom") == "snap_hook"


# ── Milestone 7: Active Speaker Tracking & Dynamic Switching Tests ───────────

def test_detect_speaker_faces_fallback_on_missing_file(tmp_path: Path):
    from app.services.speaker_tracker import detect_speaker_faces
    res = detect_speaker_faces(tmp_path / "non_existent.mp4", start_time=0.0, end_time=10.0)
    assert res["detected"] is False
    assert res["speaker_a_x_pct"] == 0.25
    assert res["speaker_b_x_pct"] == 0.75
    assert "Speaker A" in res["speakers"]
    assert "Speaker B" in res["speakers"]


def test_build_speaker_switch_schedule_and_ffmpeg_expr():
    from app.services.speaker_tracker import (
        build_ffmpeg_crop_x_expr,
        build_speaker_switch_schedule,
    )

    segments = [
        {"start_time": 0.0, "end_time": 4.5, "speaker_label": "Speaker A", "text": "Halo saya penutur pertama."},
        {"start_time": 4.5, "end_time": 10.0, "speaker_label": "Speaker B", "text": "Dan saya penutur kedua dari sisi kanan."},
    ]

    schedule = build_speaker_switch_schedule(
        segments=segments,
        clip_start=0.0,
        clip_end=10.0,
        speaker_a_x_pct=0.25,
        speaker_b_x_pct=0.75,
        scaled_width=3414,
        crop_width=1080,
    )

    assert len(schedule) == 2
    assert schedule[0]["speaker"] == "Speaker A"
    assert schedule[0]["x"] == 314
    assert schedule[1]["speaker"] == "Speaker B"
    assert schedule[1]["x"] == 2020
    assert schedule[-1]["end"] == 10.0

    expr = build_ffmpeg_crop_x_expr(schedule)
    assert "if(lt(t,4.50),314,2020)" in expr


def test_build_filter_graph_speaker_track():
    from app.services.video_renderer import build_filter_graph

    fg, label = build_filter_graph(
        aspect_ratio="9:16",
        crop_mode="speaker_track",
        speaker_crop_expr="if(lt(t,4.50),314,2020)",
        auto_zoom="none",
    )
    assert "scale=3414:1920" in fg
    assert "crop=1080:1920:x='if(lt(t,4.50),314,2020)':y='(in_h-1920)/2'" in fg
    assert label == "[v_speaker_track]"


def test_build_filter_graph_speaker_track_with_auto_zoom():
    from app.services.video_renderer import build_filter_graph

    fg, label = build_filter_graph(
        aspect_ratio="9:16",
        crop_mode="speaker_track",
        auto_zoom="subtle",
    )
    assert "scale=3414:1920" in fg
    assert "[v_base]" in fg
    assert "scale=w='2*trunc(1080*(1+0.12*" in fg
    assert label == "[v_zoomed]"


def test_trigger_render_with_speaker_track_mode(
    client: TestClient, project_with_clip, tmp_path: Path
):
    clip_id, proj_id, _ = project_with_clip
    fake_output_mp4 = tmp_path / "exports" / f"clip_spk_{clip_id}.mp4"
    called_kwargs = {}

    def fake_render(*args, **kwargs):
        called_kwargs.update(kwargs)
        fake_output_mp4.parent.mkdir(parents=True, exist_ok=True)
        fake_output_mp4.write_bytes(b"rendered speaker tracked video")
        if "set_progress" in kwargs and kwargs["set_progress"]:
            kwargs["set_progress"](100)
        return fake_output_mp4

    with patch("app.services.video_renderer.render_video_clip", side_effect=fake_render):
        r_resp = client.post(
            f"/api/clips/{clip_id}/render",
            json={
                "aspect_ratio": "9:16",
                "subtitle_style": "condensed_clean",
                "crop_mode": "speaker_track",
                "auto_zoom": "subtle",
            },
        )
        assert r_resp.status_code == 202
        job_id = r_resp.json()["job_id"]

        for _ in range(100):
            j_resp = client.get(f"/api/jobs/{job_id}")
            if j_resp.status_code == 200 and j_resp.json()["status"] in ("completed", "failed"):
                break
            time.sleep(0.05)

    assert called_kwargs.get("crop_mode") == "speaker_track"
    assert called_kwargs.get("subtitle_style") == "condensed_clean"
    assert called_kwargs.get("auto_zoom") == "subtle"



