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
    EMOJI_KEYWORD_MAP,
    create_clip_subtitle_file,
    escape_ffmpeg_filter_path,
    format_ass_time,
    generate_ass_subtitle_content,
    get_word_emoji,
    inject_emojis_into_text,
    resolve_clip_segments,
)
from app.services.video_renderer import (
    build_aspect_ratio_crop_filter,
    build_filter_graph,
    compute_audible_segments,
    detect_silence_segments,
    get_target_dimensions,
    parse_silencedetect_output,
    remove_silence_from_video,
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


def test_remap_timestamp_and_segments_for_silence():
    from app.services.subtitle_burner import (
        remap_timestamp_for_silence,
        remap_segments_for_silence,
    )
    # 10s clip with silence between 3.0 and 5.0 cut out
    # Audible segments: [(0.0, 3.0), (5.0, 10.0)]
    audible = [(0.0, 3.0), (5.0, 10.0)]

    # Before cut: t = 2.0 -> 2.0
    assert remap_timestamp_for_silence(2.0, audible) == 2.0
    # Inside cut silence: t = 4.0 -> clamped to end of first segment (3.0)
    assert remap_timestamp_for_silence(4.0, audible) == 3.0
    # After cut: t = 6.0 -> 3.0 + (6.0 - 5.0) = 4.0
    assert remap_timestamp_for_silence(6.0, audible) == 4.0

    # Remap segments
    segments = [
        {"start_time": 101.0, "end_time": 102.5, "text": "Sebelum hening."},
        {"start_time": 106.0, "end_time": 108.0, "text": "Setelah hening.", "words": [
            {"word": "Setelah", "start": 106.0, "end": 107.0},
            {"word": "hening.", "start": 107.0, "end": 108.0},
        ]},
    ]
    # clip_start = 100.0
    remapped = remap_segments_for_silence(segments, clip_start=100.0, audible_segments=audible)
    assert len(remapped) == 2
    assert remapped[0]["start_time"] == 1.0
    assert remapped[0]["end_time"] == 2.5
    assert remapped[1]["start_time"] == 4.0  # 3.0 + (6.0 - 5.0)
    assert remapped[1]["end_time"] == 6.0    # 3.0 + (8.0 - 5.0)
    assert remapped[1]["words"][0]["start"] == 4.0
    assert remapped[1]["words"][0]["end"] == 5.0



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
    assert "scale=w='2*trunc(1080*if(lt(mod(t, 5), 2.0), 1.20, 1.00)/2)'" in fg
    assert "crop=1080:1920" in fg
    assert label == "[v_zoomed]"


def test_build_filter_graph_auto_zoom_punchy_center_crop():
    fg, label = build_filter_graph(
        aspect_ratio="9:16",
        crop_mode="center_crop",
        auto_zoom="punchy",
    )
    assert "[v_base]" in fg
    assert "scale=w='2*trunc(1080*if(lt(mod(t, 4), 1.5), 1.25, 1.00)/2)'" in fg
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
    assert "Arial Black" in content or "Impact" in content
    assert "&H00FFFFFF" in content  # Pure crisp white main text
    assert "&H0000FFCC" in content  # Electric Lime / Neon Lime secondary
    assert "&H00000000" in content  # Pitch-black outline (border 4.0)
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
    # Medium Shot: scale_w = 3414 (16:9 native for 1920h, no extra punch-in)
    assert "scale=3414:1920" in fg
    # Y crop: 18% headroom from top using dynamic max(0,...)*0.18 expression
    assert "y='max(0,in_h-1920)*0.18'" in fg
    # X crop driven by speaker expression
    assert "crop=1080:1920:x='if(lt(t,4.50),314,2020)'" in fg
    assert label == "[v_speaker_track]"


def test_build_filter_graph_speaker_track_with_auto_zoom():
    from app.services.video_renderer import build_filter_graph

    fg, label = build_filter_graph(
        aspect_ratio="9:16",
        crop_mode="speaker_track",
        auto_zoom="subtle",
    )
    # Medium Shot: scale_w = 3414 (1.0x native 16:9 for 1920h)
    assert "scale=3414:1920" in fg
    assert "[v_base]" in fg
    assert "if(lt(mod(t, 5), 2.0), 1.20, 1.00)" in fg
    assert label == "[v_zoomed]"


def test_speaker_switch_anti_jitter_and_overlap_lock():
    from app.services.speaker_tracker import build_speaker_switch_schedule

    # Case 1: Overlap Conflict. Speaker A speaks 0.0 - 5.0, Speaker B interjects 1.5 - 2.5 (1s overlap)
    # Camera should lock onto Speaker A and ignore Speaker B's brief submerged interjection!
    segments = [
        {"start_time": 0.0, "end_time": 5.0, "speaker_label": "Speaker A", "text": "Saya sedang berbicara penting."},
        {"start_time": 1.5, "end_time": 2.5, "speaker_label": "Speaker B", "text": "Bener banget!"},
        {"start_time": 5.0, "end_time": 10.0, "speaker_label": "Speaker B", "text": "Sekarang giliran saya menjelaskan."},
    ]

    schedule = build_speaker_switch_schedule(
        segments=segments,
        clip_start=0.0,
        clip_end=10.0,
        speaker_a_x_pct=0.25,
        speaker_b_x_pct=0.75,
        scaled_width=4268,
        crop_width=1080,
        min_hold_duration=2.8,
    )

    # There should only be 2 stable shots: 0.0-5.0 (Speaker A) and 5.0-10.0 (Speaker B)
    # No jitter cut to Speaker B at 1.5s!
    assert len(schedule) == 2
    assert schedule[0]["speaker"] == "Speaker A"
    assert schedule[0]["start"] == 0.0
    assert schedule[0]["end"] == 5.0
    assert schedule[1]["speaker"] == "Speaker B"
    assert schedule[1]["start"] == 5.0
    assert schedule[1]["end"] == 10.0


def test_word_highlight_short_chunking():
    # Long 8-word sentence should be split into short 3-4 word chunks
    segments = [
        {
            "start_time": 0.0,
            "end_time": 4.0,
            "text": "Kita tidak akan pernah bisa mengulang waktu lagi.",
        }
    ]
    content = generate_ass_subtitle_content(
        segments=segments,
        clip_start=0.0,
        clip_end=4.0,
        subtitle_style="word_highlight",
    )
    assert content is not None
    # Count dialogue lines: should have at least 2 dialogue chunks for 8 words
    dialogues = [line for line in content.splitlines() if line.startswith("Dialogue: 0,")]
    assert len(dialogues) >= 2
    for d in dialogues:
        assert r"{\kf" in d


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


# ── Milestone 8: Gaming / Streamer Split, HeadlineBanner & SEO Scorer Tests ──

def test_detect_streamer_facecam_fallback(tmp_path: Path):
    from app.services.speaker_tracker import detect_streamer_facecam

    res = detect_streamer_facecam(tmp_path / "non_existent.mp4", start_time=0.0, end_time=10.0)
    assert res["detected"] is False
    assert res["corner"] == "bottom_right"
    assert res["face_x_pct"] == 0.85
    assert res["face_y_pct"] == 0.75


def test_build_filter_graph_streamer_split():
    from app.services.video_renderer import build_filter_graph

    fg, label = build_filter_graph(
        aspect_ratio="9:16",
        crop_mode="streamer_split",
        auto_zoom="none",
        facecam_crop_params={
            "detected": True,
            "face_x_pct": 0.85,
            "face_y_pct": 0.75,
            "corner": "bottom_right",
        },
    )
    assert "split=2" in fg
    assert "vstack=inputs=2" in fg
    assert "scale=1080:960" in fg
    assert label == "[v_streamer_split]"


def test_build_filter_graph_streamer_split_with_auto_zoom():
    from app.services.video_renderer import build_filter_graph

    fg, label = build_filter_graph(
        aspect_ratio="9:16",
        crop_mode="streamer_split",
        auto_zoom="subtle",
    )
    assert "vstack=inputs=2[v_base]" in fg
    assert "if(lt(mod(t, 5), 2.0), 1.20, 1.00)" in fg
    assert label == "[v_zoomed]"


def test_generate_ass_subtitle_headline_banner_streamer_split():
    from app.services.subtitle_burner import (
        build_headline_banner_dialogue,
        generate_ass_subtitle_content,
    )

    segments = [{"start_time": 0.0, "end_time": 5.0, "text": "Gameplay momen epik."}]
    content = generate_ass_subtitle_content(
        segments=segments,
        clip_start=0.0,
        clip_end=5.0,
        subtitle_style="condensed_clean",
        headline_text="DETIK-DETIK CLUTCH 1V4 PALING GILA!",
        is_streamer_split=True,
    )
    assert content is not None
    assert "Style: HeadlineBanner" in content
    # BorderStyle=3, Outline=10, Alignment=5 (center split boundary)
    assert ",3,10,0,5,40,40,0,1" in content
    assert "Dialogue: 1,0:00:00.00,0:00:05.00,HeadlineBanner,,0,0,0,,DETIK-DETIK CLUTCH 1V4 PALING GILA!" in content

    # Test standalone helper
    dialogue_line = build_headline_banner_dialogue("Momen Kaget!", 8.5)
    assert "HeadlineBanner" in dialogue_line
    assert "0:00:08.50" in dialogue_line
    assert "MOMEN KAGET!" in dialogue_line


def test_seo_scorer_analysis_and_recommendations():
    from app.services.seo_scorer import (
        analyze_title_seo,
        generate_seo_title_recommendations,
    )

    # 1. High-scoring title (length 30-65, power words, number, curiosity gap)
    res_high = analyze_title_seo("Kaget Banget! 3 Trik Ternyata Gak Bisa Ditiru?")
    assert res_high["score"] >= 80
    assert res_high["rating"] == "good"
    assert len(res_high["checklist"]) == 4
    assert "kaget" in res_high["matched_power_words"]

    # 2. Low-scoring title (too short, no power words, lowercase, no numbers/punctuation)
    res_low = analyze_title_seo("video main game")
    assert res_low["score"] < 50
    assert res_low["rating"] == "poor"
    assert len(res_low["suggestions"]) > 0

    # 3. Recommendations generation (algorithmic fallback)
    with patch("app.services.seo_scorer.settings.GEMINI_API_KEY", None):
        recs = generate_seo_title_recommendations(
            current_title="Gameplay Biasa",
            hook="Momen clutch paling epic",
        )
    assert len(recs) == 3
    for r in recs:
        assert "title" in r
        assert r["score"] >= 75
        assert r["rating"] == "good"


def test_trigger_render_with_streamer_split_mode(
    client: TestClient, project_with_clip, tmp_path: Path
):
    clip_id, proj_id, _ = project_with_clip
    fake_output_mp4 = tmp_path / "exports" / f"clip_split_{clip_id}.mp4"
    called_kwargs = {}

    def fake_render(*args, **kwargs):
        called_kwargs.update(kwargs)
        fake_output_mp4.parent.mkdir(parents=True, exist_ok=True)
        fake_output_mp4.write_bytes(b"rendered streamer split video")
        if "set_progress" in kwargs and kwargs["set_progress"]:
            kwargs["set_progress"](100)
        return fake_output_mp4

    with patch("app.services.video_renderer.render_video_clip", side_effect=fake_render):
        r_resp = client.post(
            f"/api/clips/{clip_id}/render",
            json={
                "aspect_ratio": "9:16",
                "subtitle_style": "condensed_clean",
                "crop_mode": "streamer_split",
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

    assert called_kwargs.get("crop_mode") == "streamer_split"
    assert called_kwargs.get("subtitle_style") == "condensed_clean"


def test_analyze_and_recommend_title_endpoints(client: TestClient, project_with_clip):
    clip_id, _, _ = project_with_clip

    # 1. Analyze title endpoint with explicit title
    resp = client.post(
        f"/api/clips/{clip_id}/analyze-title",
        json={"title": "Ternyata Ini Rahasia 3 Trik yang Gak Bisa Dibongkar?"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["score"] >= 80
    assert data["rating"] == "good"
    assert len(data["checklist"]) == 4

    # 2. Analyze title endpoint using clip's existing title
    resp_default = client.post(
        f"/api/clips/{clip_id}/analyze-title",
        json={},
    )
    assert resp_default.status_code == 200
    data_def = resp_default.json()
    assert "score" in data_def
    assert "checklist" in data_def

    # 3. Recommend titles endpoint (with patched API key for fast local test)
    with patch("app.services.seo_scorer.settings.GEMINI_API_KEY", None):
        resp_rec = client.post(f"/api/clips/{clip_id}/recommend-titles")
    assert resp_rec.status_code == 200
    data_rec = resp_rec.json()
    assert data_rec["clip_id"] == clip_id
    assert len(data_rec["recommendations"]) == 3
    for rec in data_rec["recommendations"]:
        assert rec["score"] >= 75


# ── Milestone 9: Podcast Multicam, Shared Laugh Wide-Shot, Subtitle Pop & SFX Engine ──

def test_multicam_shared_laugh_wide_shot_and_silence_fallback():
    from app.services.speaker_tracker import build_speaker_switch_schedule

    # Case 1: Shared Laugh / Overlap >= 1.2s
    # Speaker A speaks 0.0 - 5.0 ("haha ini lucu banget")
    # Speaker B laughs together 2.0 - 4.5 ("wkwk beneran") -> overlap is 2.5s >= 1.2s with laugh keywords
    # Revised behavior: camera HOLDS on Speaker A (no center rack cut)
    segments = [
        {"start_time": 0.0, "end_time": 5.0, "speaker_label": "Speaker A", "text": "haha ini lucu banget"},
        {"start_time": 2.0, "end_time": 4.5, "speaker_label": "Speaker B", "text": "wkwk beneran bro"},
        {"start_time": 5.0, "end_time": 8.0, "speaker_label": "Speaker B", "text": "Lanjut penjelasan berikutnya"},
    ]

    schedule = build_speaker_switch_schedule(
        segments=segments,
        clip_start=0.0,
        clip_end=8.0,
        scaled_width=3414,
        crop_width=1080,
    )

    speakers_in_sched = [s["speaker"] for s in schedule]
    # No Wide 2-Shot — camera stays locked on speakers
    assert "Wide 2-Shot" not in speakers_in_sched
    # Speaker A should appear in schedule
    assert any(s["speaker"] == "Speaker A" for s in schedule)
    # Schedule covers full duration
    assert schedule[-1]["end"] == 8.0

    # Case 2: Silence fallback > 1.0s
    # Speaker A speaks 0.0 - 3.0, silence 3.0 - 5.5 (2.5s gap), Speaker B speaks 5.5 - 9.0
    # Revised behavior: camera holds on last active speaker (Speaker A) during silence gap
    segments_silence = [
        {"start_time": 0.0, "end_time": 3.0, "speaker_label": "Speaker A", "text": "Saya selesai di sini."},
        {"start_time": 5.5, "end_time": 9.0, "speaker_label": "Speaker B", "text": "Setelah berpikir lama, saya jawab."},
    ]
    schedule_silence = build_speaker_switch_schedule(
        segments=segments_silence,
        clip_start=0.0,
        clip_end=9.0,
        scaled_width=3414,
        crop_width=1080,
    )
    # No Wide 2-Shot during silence gap
    assert "Wide 2-Shot" not in [s["speaker"] for s in schedule_silence]
    # Gap 3.0 - 5.5 should hold on Speaker A (x=314)
    x_speaker_a = max(0, min(3414 - 1080, round(3414 * 0.25 - 1080 / 2)))
    shot_covering_gap = [s for s in schedule_silence if s["start"] <= 3.0 and s["end"] >= 5.5]
    assert len(shot_covering_gap) == 1
    assert shot_covering_gap[0]["speaker"] == "Speaker A"
    assert shot_covering_gap[0]["x"] == x_speaker_a

    # Case 3: Framing offset check
    sched_offset = build_speaker_switch_schedule(
        segments=[{"start_time": 0.0, "end_time": 5.0, "speaker_label": "Speaker A", "text": "Halo"}],
        clip_start=0.0,
        clip_end=5.0,
        scaled_width=3414,
        crop_width=1080,
        framing_offset_pct=0.05,
    )
    # Expected shifted X: 314 + int(round(3414 * 0.05)) = 314 + 171 = 485
    assert sched_offset[0]["x"] == 485


def test_procedural_sfx_generators(tmp_path: Path):
    from app.services.video_renderer import (
        generate_whoosh_sfx,
        generate_pop_sfx,
        build_sfx_audio_track,
    )
    import wave

    whoosh_wav = tmp_path / "whoosh.wav"
    pop_wav = tmp_path / "pop.wav"
    combined_wav = tmp_path / "sfx_track.wav"

    generate_whoosh_sfx(whoosh_wav, duration=0.20)
    assert whoosh_wav.exists()
    with wave.open(str(whoosh_wav), "rb") as wf:
        assert wf.getframerate() == 44100
        assert wf.getnchannels() == 1
        assert wf.getsampwidth() == 2
        assert wf.getnframes() == int(44100 * 0.20)

    generate_pop_sfx(pop_wav, duration=0.08)
    assert pop_wav.exists()
    with wave.open(str(pop_wav), "rb") as wf:
        assert wf.getframerate() == 44100
        assert wf.getnchannels() == 1
        assert wf.getnframes() == int(44100 * 0.08)

    # Test combined audio track
    track_path = build_sfx_audio_track(
        output_path=combined_wav,
        duration=5.0,
        switch_times=[2.5],
        pop_times=[0.08],
    )
    assert track_path is not None
    assert track_path.exists()
    with wave.open(str(track_path), "rb") as wf:
        assert wf.getframerate() == 44100
        assert wf.getnframes() == int(44100 * 5.0)


def test_subtitle_word_highlight_punchy_pop_and_intro_hook_card():
    from app.services.subtitle_burner import generate_ass_subtitle_content

    segments = [
        {
            "start_time": 0.0,
            "end_time": 3.0,
            "text": "Rahasia sukses podcast viral terbongkar.",
        }
    ]

    content = generate_ass_subtitle_content(
        segments=segments,
        clip_start=0.0,
        clip_end=5.0,
        subtitle_style="word_highlight",
        play_res_x=1080,
        play_res_y=1920,
        headline_text="TRIK VIRAL PODCAST",
        intro_hook_banner=True,
    )

    assert content is not None
    # 1. MarginV: 320 for TikTok/Shorts safe zone
    assert ",320,1" in content

    # 2. Pop-up scale tag and active yellow
    assert r"\fscx112\fscy112" in content
    assert r"\c&H0000E5FF" in content

    # 3. Clean Aesthetic Hook Card (0.0 to 1.5s) — no red badge
    assert "Style: HookClean" in content
    assert "HookBadge" not in content      # Red badge must be absent
    assert "HookCardTitle" not in content  # Old red box title must be absent
    assert "\ud83d\udd25 VIRAL MOMEN" not in content  # Fire emoji badge must be absent
    assert "TRIK VIRAL PODCAST" in content
    assert r"{\fad(0,300)}" in content
    assert "Dialogue: 2,0:00:00.00,0:00:01.50,HookClean" in content


def test_render_video_clip_with_sfx_amix(tmp_path: Path):
    from app.services.video_renderer import render_video_clip
    from unittest.mock import MagicMock, patch

    src = tmp_path / "src_test.mp4"
    src.write_bytes(b"dummy mp4")
    out = tmp_path / "out_test.mp4"

    mock_proc = MagicMock()
    mock_proc.poll.return_value = 0
    mock_proc.returncode = 0

    def fake_popen(cmd, **kwargs):
        out.write_bytes(b"rendered mp4")
        return mock_proc

    segments = [
        {"start_time": 0.0, "end_time": 3.0, "speaker_label": "Speaker A", "text": "Halo"},
        {"start_time": 3.0, "end_time": 6.0, "speaker_label": "Speaker B", "text": "Halo juga"},
    ]

    with patch("subprocess.Popen", side_effect=fake_popen) as popen_mock:
        render_video_clip(
            source_video_path=src,
            output_path=out,
            start_time=0.0,
            end_time=6.0,
            aspect_ratio="9:16",
            crop_mode="speaker_track",
            subtitle_style="word_highlight",
            segments=segments,
            headline_text="VIRAL MOMEN",
            intro_hook_banner=True,
            enable_sfx=True,
        )

        assert popen_mock.called
        cmd = popen_mock.call_args[0][0]
        # Check that SFX audio track is passed and mixed with amix
        assert any(".sfx.wav" in arg for arg in cmd)
        cmd_str = " ".join(cmd)
        assert "amix=inputs=2" in cmd_str
        assert "-map [a_out]" in cmd_str


# ── Milestone 6: Smart Music Studio & Background Speech Auto-Ducking Tests ───

def test_music_procedural_tracks_and_catalog(tmp_path: Path):
    from app.services.music_service import (
        generate_lofi_chill_track,
        generate_comedy_quirky_track,
        generate_suspense_tension_track,
        list_music_tracks,
        get_music_track_path,
    )
    import wave

    lofi_path = tmp_path / "test_lofi.wav"
    generate_lofi_chill_track(lofi_path)
    assert lofi_path.exists()
    assert lofi_path.stat().st_size > 50000
    with wave.open(str(lofi_path), "rb") as wf:
        assert wf.getnchannels() == 2
        assert wf.getframerate() == 44100
        assert wf.getsampwidth() == 2

    comedy_path = tmp_path / "test_comedy.wav"
    generate_comedy_quirky_track(comedy_path)
    assert comedy_path.exists()
    assert comedy_path.stat().st_size > 50000
    with wave.open(str(comedy_path), "rb") as wf:
        assert wf.getnchannels() == 2
        assert wf.getframerate() == 44100

    suspense_path = tmp_path / "test_suspense.wav"
    generate_suspense_tension_track(suspense_path)
    assert suspense_path.exists()
    assert suspense_path.stat().st_size > 50000

    tracks = list_music_tracks()
    assert len(tracks) >= 3
    track_ids = [t["id"] for t in tracks]
    assert "lofi_chill" in track_ids
    assert "comedy_quirky" in track_ids
    assert "suspense_tension" in track_ids

    p = get_music_track_path("lofi_chill")
    assert p is not None
    assert p.exists()


def test_music_api_endpoints(client):
    # 1. GET /api/music
    resp = client.get("/api/music")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_tracks"] >= 3
    track_ids = [t["id"] for t in data["tracks"]]
    assert "lofi_chill" in track_ids

    # 2. GET /api/music/{id}/stream
    s_resp = client.get("/api/music/lofi_chill/stream")
    assert s_resp.status_code == 200
    assert "audio/" in s_resp.headers.get("content-type", "")
    assert len(s_resp.content) > 1000

    # 3. POST /api/music/upload
    import io
    fake_wav_buf = io.BytesIO(b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00")
    up_resp = client.post(
        "/api/music/upload",
        files={"file": ("my_podcast_beat.wav", fake_wav_buf, "audio/wav")},
        data={"name": "My Custom Beat"},
    )
    assert up_resp.status_code == 201
    up_data = up_resp.json()
    assert up_data["is_custom"] is True
    assert up_data["name"] == "My Custom Beat"
    assert "/api/music/" in up_data["file_url"]


def test_render_video_clip_with_bgm_auto_ducking(tmp_path: Path):
    from app.services.video_renderer import render_video_clip
    from unittest.mock import MagicMock, patch

    src = tmp_path / "src_test_bgm.mp4"
    src.write_bytes(b"dummy mp4 with audio")
    out = tmp_path / "out_test_bgm.mp4"

    mock_proc = MagicMock()
    mock_proc.poll.return_value = 0
    mock_proc.returncode = 0

    def fake_popen(cmd, **kwargs):
        out.write_bytes(b"rendered mp4 with ducked bgm")
        return mock_proc

    with patch("subprocess.Popen", side_effect=fake_popen) as popen_mock:
        render_video_clip(
            source_video_path=src,
            output_path=out,
            start_time=0.0,
            end_time=5.0,
            aspect_ratio="9:16",
            crop_mode="center_crop",
            subtitle_style="none",
            bgm_track_id="lofi_chill",
            bgm_volume=0.22,
            enable_sfx=True,
        )

        assert popen_mock.called
        cmd = popen_mock.call_args[0][0]
        cmd_str = " ".join(cmd)

        # Check BGM track input with infinite loop
        assert "-stream_loop -1 -i" in cmd_str
        assert "lofi_chill.wav" in cmd_str

        # Check sidechaincompress auto-ducking filter chain
        assert "sidechaincompress=threshold=0.10:ratio=8:attack=15:release=450:makeup=1[ducked_bgm]" in cmd_str
        assert "volume=0.22" in cmd_str
        assert "-map [a_out]" in cmd_str


# ── Soundboard & Reaction SFX Unit & Integration Tests ───────────────────────

def test_soundboard_procedural_generators(tmp_path: Path):
    """Test procedural synthesis for all 5 built-in meme sound effects."""
    from app.services.soundboard_service import (
        generate_vine_boom,
        generate_record_scratch,
        generate_ding_bell,
        generate_crickets_silence,
        generate_bruh_thud,
    )
    import wave

    sounds = [
        ("vine_boom.wav", generate_vine_boom, 0.8),
        ("record_scratch.wav", generate_record_scratch, 0.4),
        ("ding_bell.wav", generate_ding_bell, 0.5),
        ("crickets_silence.wav", generate_crickets_silence, 1.5),
        ("bruh_thud.wav", generate_bruh_thud, 0.6),
    ]

    for fname, generator_fn, expected_min_dur in sounds:
        p = tmp_path / fname
        out = generator_fn(p)
        assert out.exists()
        assert out.stat().st_size > 500

        with wave.open(str(out), "rb") as wf:
            assert wf.getnchannels() == 2
            assert wf.getsampwidth() == 2
            assert wf.getframerate() == 44100
            actual_dur = wf.getnframes() / 44100.0
            assert abs(actual_dur - expected_min_dur) < 0.05


def test_soundboard_service_listing_and_custom_upload(tmp_path: Path):
    """Test listing available soundboard sounds and custom SFX audio upload."""
    from app.services.soundboard_service import (
        list_soundboard_sounds,
        get_sound_file_path,
        save_custom_sound,
    )

    with patch("app.services.soundboard_service.get_soundboard_dir", return_value=tmp_path):
        sounds = list_soundboard_sounds()
        preset_ids = [s["id"] for s in sounds]
        assert "vine_boom" in preset_ids
        assert "record_scratch" in preset_ids
        assert "ding_bell" in preset_ids
        assert "crickets_silence" in preset_ids
        assert "bruh_thud" in preset_ids

        # Check icons and properties
        vb = next(s for s in sounds if s["id"] == "vine_boom")
        assert vb["icon"] == "💥"
        assert vb["duration"] == 0.8

        # Test resolving sound file path
        vb_path = get_sound_file_path("vine_boom")
        assert vb_path is not None
        assert vb_path.exists()

        # Test custom audio upload
        dummy_wav_header = b"RIFF$   WAVEfmt \x10\x00\x00\x00\x01\x00\x02\x00D\xac\x00\x00\x10\xb1\x02\x00\x04\x00\x10\x00data\x00\x00\x00\x00"
        custom_item = save_custom_sound("airhorn_meme.wav", dummy_wav_header, "Airhorn MLG")
        assert custom_item["name"] == "Airhorn MLG"
        assert custom_item["is_custom"] is True
        assert (tmp_path / custom_item["filename"]).exists()

        # Invalid extension error
        with pytest.raises(ValueError):
            save_custom_sound("invalid.txt", b"not audio")


def test_render_video_clip_with_soundboard_multi_adelay_mixer(tmp_path: Path):
    """Test FFmpeg command generation for multi-point SFX mixer using adelay and amix."""
    src = tmp_path / "src_video.mp4"
    src.write_bytes(b"dummy video with audio")
    out = tmp_path / "rendered_soundboard.mp4"

    # Pre-generate sound files in tmp_path
    sb_dir = tmp_path / "soundboard"
    sb_dir.mkdir(parents=True, exist_ok=True)
    from app.services.soundboard_service import generate_vine_boom, generate_ding_bell
    generate_vine_boom(sb_dir / "vine_boom.wav")
    generate_ding_bell(sb_dir / "ding_bell.wav")

    mock_proc = MagicMock()
    mock_proc.poll.return_value = 0
    mock_proc.returncode = 0

    def fake_popen(cmd, **kwargs):
        out.write_bytes(b"final mp4 with mixed sfx")
        return mock_proc

    cues = [
        {"sound_id": "vine_boom", "timestamp": 1.50, "volume": 0.90},
        {"sound_id": "ding_bell", "timestamp": 3.40, "volume": 0.80},
    ]

    with patch("app.services.soundboard_service.get_soundboard_dir", return_value=sb_dir):
        with patch("subprocess.Popen", side_effect=fake_popen) as popen_mock:
            render_video_clip(
                source_video_path=src,
                output_path=out,
                start_time=0.0,
                end_time=6.0,
                aspect_ratio="9:16",
                crop_mode="center_crop",
                subtitle_style="none",
                soundboard_cues=cues,
            )

            assert popen_mock.called
            cmd = popen_mock.call_args[0][0]
            cmd_str = " ".join(cmd)

            # Check both SFX files added as inputs
            assert "vine_boom.wav" in cmd_str
            assert "ding_bell.wav" in cmd_str

            # Check millisecond-precision adelay filters (1.50s -> 1500ms, 3.40s -> 3400ms)
            assert "adelay=1500|1500" in cmd_str
            assert "adelay=3400|3400" in cmd_str

            # Check individual volumes
            assert "volume=0.90" in cmd_str
            assert "volume=0.80" in cmd_str

            # Check amix filtergraph combining source audio + 2 SFX cues
            assert "amix=inputs=3:duration=first:dropout_transition=0[a_out]" in cmd_str
            assert "-map [a_out]" in cmd_str


def test_soundboard_rest_api_endpoints(client: TestClient, tmp_path: Path):
    """Test REST API endpoints: GET /api/soundboard, GET stream, and POST upload."""
    sb_dir = tmp_path / "sb_api"
    sb_dir.mkdir(parents=True, exist_ok=True)

    with patch("app.services.soundboard_service.get_soundboard_dir", return_value=sb_dir):
        # 1. GET /api/soundboard
        resp = client.get("/api/soundboard")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 5
        sound_ids = [s["id"] for s in data]
        assert "vine_boom" in sound_ids
        assert "record_scratch" in sound_ids
        assert "ding_bell" in sound_ids
        assert "crickets_silence" in sound_ids
        assert "bruh_thud" in sound_ids

        # 2. GET /api/soundboard/{sound_id}/stream
        stream_resp = client.get("/api/soundboard/vine_boom/stream")
        assert stream_resp.status_code == 200
        assert stream_resp.headers["content-type"] == "audio/wav"
        assert len(stream_resp.content) > 500

        # Non-existent sound
        not_found_resp = client.get("/api/soundboard/non_existent/stream")
        assert not_found_resp.status_code == 404

        # 3. POST /api/soundboard/upload
        dummy_wav = b"RIFF$   WAVEfmt \x10\x00\x00\x00\x01\x00\x02\x00D\xac\x00\x00\x10\xb1\x02\x00\x04\x00\x10\x00data\x00\x00\x00\x00"
        upload_resp = client.post(
            "/api/soundboard/upload",
            files={"file": ("wow_meme.wav", dummy_wav, "audio/wav")},
            data={"name": "Anime Wow"},
        )
        assert upload_resp.status_code == 201
        up_data = upload_resp.json()
        assert up_data["name"] == "Anime Wow"
        assert up_data["is_custom"] is True
        assert "stream" in up_data["file_url"]

        # Unsupported format upload
        bad_upload = client.post(
            "/api/soundboard/upload",
            files={"file": ("virus.exe", b"dangerous", "application/octet-stream")},
        )
        assert bad_upload.status_code == 422


# ── Interactive Aspect Ratio, Reframe, Silence Removal & Auto-Emoji Tests ────

def test_aspect_ratio_dimensions_all_supported():
    assert get_target_dimensions("9:16") == (1080, 1920)
    assert get_target_dimensions("1:1") == (1080, 1080)
    assert get_target_dimensions("4:5") == (1080, 1350)
    assert get_target_dimensions("16:9") == (1920, 1080)


def test_build_aspect_ratio_crop_filter():
    # 9:16 vertical crop with different crop_x_pct values
    f_916_center, w, h = build_aspect_ratio_crop_filter("9:16", crop_x_pct=0.50)
    assert w == 1080 and h == 1920
    assert "ih*9/16" in f_916_center
    assert "(iw-ow)/2" in f_916_center
    assert "scale=1080:1920" in f_916_center

    f_916_left, _, _ = build_aspect_ratio_crop_filter("9:16", crop_x_pct=0.20)
    assert "0.2000" in f_916_left

    f_916_right, _, _ = build_aspect_ratio_crop_filter("9:16", crop_x_pct=0.80)
    assert "0.8000" in f_916_right

    # 1:1 square
    f_11, w1, h1 = build_aspect_ratio_crop_filter("1:1")
    assert w1 == 1080 and h1 == 1080
    assert "crop=w='ih':h='ih'" in f_11
    assert "scale=1080:1080" in f_11

    # 4:5 portrait
    f_45, w45, h45 = build_aspect_ratio_crop_filter("4:5", crop_x_pct=0.50)
    assert w45 == 1080 and h45 == 1350
    assert "ih*4/5" in f_45
    assert "scale=1080:1350" in f_45

    # 16:9 landscape
    f_169, w169, h169 = build_aspect_ratio_crop_filter("16:9")
    assert w169 == 1920 and h169 == 1080
    assert "scale=1920:1080" in f_169


def test_build_filter_graph_45_and_crop_x_pct():
    fg, label = build_filter_graph(
        aspect_ratio="4:5",
        crop_mode="center_crop",
        crop_x_pct=0.20,
    )
    assert "crop=1080:1350" in fg
    assert "0.2000" in fg
    assert label == "[v_cropped]"


def test_silence_detection_parsing():
    sample_ffmpeg_log = """
    [silencedetect @ 0000021b] silence_start: 1.452
    [silencedetect @ 0000021b] silence_end: 2.352 | silence_duration: 0.900
    [silencedetect @ 0000021b] silence_start: 5.120
    [silencedetect @ 0000021b] silence_end: 6.420 | silence_duration: 1.300
    """
    intervals = parse_silencedetect_output(sample_ffmpeg_log, clip_duration=10.0, min_silence_duration=0.5)
    assert len(intervals) == 2
    assert intervals[0] == (1.452, 2.352)
    assert intervals[1] == (5.12, 6.42)


def test_compute_audible_segments_cuts_silence():
    # 10s video with silence from 2.0s to 4.0s
    silence = [(2.0, 4.0)]
    audible = compute_audible_segments(silence, clip_duration=10.0, padding=0.05)
    assert len(audible) == 2
    # First chunk: 0 to ~2.05s
    assert audible[0][0] == 0.0
    assert audible[0][1] == 2.05
    # Second chunk: ~3.95s to 10.0s
    assert audible[1][0] == 3.95
    assert audible[1][1] == 10.0


def test_compute_audible_segments_no_silence():
    audible = compute_audible_segments([], clip_duration=15.0)
    assert audible == [(0.0, 15.0)]


def test_detect_silence_segments_mocked(tmp_path: Path):
    dummy_video = tmp_path / "sample.mp4"
    dummy_video.write_bytes(b"dummy mp4")

    mock_proc = MagicMock()
    mock_proc.stderr = (
        "[silencedetect @ 0x123] silence_start: 2.100\n"
        "[silencedetect @ 0x123] silence_end: 3.200 | silence_duration: 1.100\n"
    )
    mock_proc.stdout = ""
    mock_proc.returncode = 0

    with patch("subprocess.run", return_value=mock_proc):
        silent_intervals = detect_silence_segments(dummy_video, start_time=0.0, end_time=10.0)
        assert len(silent_intervals) == 1
        assert silent_intervals[0] == (2.1, 3.2)


def test_auto_emoji_keyword_dictionary_and_helpers():
    # Indonesian keywords
    assert get_word_emoji("uang") == "💸"
    assert get_word_emoji("cuan") == "💸"
    assert get_word_emoji("kaget!") == "😱"
    assert get_word_emoji("GILA") == "😱"
    assert get_word_emoji("viral") == "🔥"
    assert get_word_emoji("ngakak") == "😂"
    assert get_word_emoji("tips...") == "💡"

    # English keywords
    assert get_word_emoji("money") == "💸"
    assert get_word_emoji("rich") == "💸"
    assert get_word_emoji("shock") == "😱"
    assert get_word_emoji("fire") == "🔥"
    assert get_word_emoji("lol") == "😂"
    assert get_word_emoji("hack") == "💡"

    # Injected plain text
    injected = inject_emojis_into_text("dapat cuan banyak dan tips viral")
    assert "cuan 💸" in injected
    assert "tips 💡" in injected
    assert "viral 🔥" in injected


def test_auto_emoji_in_karaoke_dialogue():
    segments = [
        {
            "start_time": 0.0,
            "end_time": 2.0,
            "text": "Dapat cuan uang ide",
            "words": [
                {"word": "Dapat", "start": 0.0, "end": 0.5},
                {"word": "cuan", "start": 0.5, "end": 1.0},
                {"word": "uang", "start": 1.0, "end": 1.5},
                {"word": "ide", "start": 1.5, "end": 2.0},
            ],
        }
    ]
    content = generate_ass_subtitle_content(
        segments=segments,
        clip_start=0.0,
        clip_end=2.0,
        subtitle_style="word_highlight",
        auto_emoji=True,
    )
    assert content is not None
    # Verify emojis are injected next to highlight words
    assert "CUAN 💸" in content
    assert "UANG 💸" in content
    assert "IDE 💡" in content
    # Verify timing tags are preserved: 0.5s duration is 50 centiseconds: \kf50
    assert "\\kf50" in content









