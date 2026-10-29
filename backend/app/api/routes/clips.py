"""
clips.py — API routes for AI-curated clip candidates management.

Endpoints:
  POST   /api/projects/{id}/find-clips  — Trigger Gemini AI clip curation job
  GET    /api/projects/{id}/clips       — List curated clip candidates
  PATCH  /api/clips/{id}                — Edit trim points (start/end) or status
  DELETE /api/clips/{id}                — Remove clip candidate
"""
from __future__ import annotations

import io
import json
import logging
import re
import subprocess
import zipfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.clip import ClipCandidate
from app.models.job import Job
from app.models.project import Project
from app.models.transcript import TranscriptSegment
from app.schemas.clip import (
    ClipCandidateRead,
    ClipCandidateUpdate,
    ClipListResponse,
    ClipRenderRequest,
    ClipRenderResponse,
    ClipSubtitleSegment,
    FindClipsResponse,
    ManualClipCreateRequest,
    SocialCopyItem,
    SocialCopyRequest,
    SocialCopyResponse,
    TitleAnalysisRequest,
    TitleAnalysisResponse,
    TitleRecommendationsResponse,
)
from app.services.seo_scorer import (
    analyze_title_seo,
    generate_seo_title_recommendations,
)
from app.services.social_copywriter import generate_social_copy
from app.services.job_queue import job_queue

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Clips"])


def _get_project_or_404(project_id: str, db: Session) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project '{project_id}' not found.",
        )
    return project


def _get_clip_or_404(clip_id: str, db: Session) -> ClipCandidate:
    clip = db.get(ClipCandidate, clip_id)
    if not clip:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Clip candidate '{clip_id}' not found.",
        )
    return clip


# ── POST /api/projects/{id}/find-clips ───────────────────────────────────────

@router.post(
    "/projects/{project_id}/find-clips",
    response_model=FindClipsResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger AI Clip Finder curation job for a project",
)
async def trigger_find_clips(
    project_id: str,
    db: Session = Depends(get_db),
) -> FindClipsResponse:
    _get_project_or_404(project_id, db)

    # Check that transcript exists
    count = db.execute(
        select(TranscriptSegment)
        .where(TranscriptSegment.project_id == project_id)
        .limit(1)
    ).scalars().first()

    if not count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transkrip belum tersedia. Jalankan proses transkripsi terlebih dahulu.",
        )

    # Create & enqueue background job
    job = Job(
        project_id=project_id,
        job_type="find_clips",
        status="pending",
        progress=0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    await job_queue.enqueue(job.id)

    return FindClipsResponse(
        project_id=project_id,
        job_id=job.id,
        message="Pekerjaan pencarian klip viral AI telah dijadwalkan.",
    )


# ── GET /api/projects/{id}/clips ─────────────────────────────────────────────

@router.get(
    "/projects/{project_id}/clips",
    response_model=ClipListResponse,
    summary="List all curated clip candidates for a project",
)
def list_project_clips(
    project_id: str,
    db: Session = Depends(get_db),
) -> ClipListResponse:
    _get_project_or_404(project_id, db)

    clips = db.execute(
        select(ClipCandidate)
        .where(ClipCandidate.project_id == project_id)
        .order_by(desc(ClipCandidate.virality_score))
    ).scalars().all()

    items = [ClipCandidateRead.model_validate(c) for c in clips]
    return ClipListResponse(
        project_id=project_id,
        total_clips=len(items),
        clips=items,
    )


# ── POST /api/projects/{id}/clips/manual ─────────────────────────────────────

@router.post(
    "/projects/{project_id}/clips/manual",
    response_model=ClipCandidateRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a manual clip candidate for CapCut-style timeline editing",
)
def create_manual_clip(
    project_id: str,
    payload: ManualClipCreateRequest = ManualClipCreateRequest(),
    db: Session = Depends(get_db),
) -> ClipCandidateRead:
    project = _get_project_or_404(project_id, db)

    proj_dur = project.duration if project.duration and project.duration > 0 else 60.0
    start = max(0.0, round(payload.start_time, 2))
    if payload.end_time is not None and payload.end_time > start:
        end = min(proj_dur, round(payload.end_time, 2))
    else:
        # Default to 30s clip or duration of video
        end = min(proj_dur, start + 30.0)
        if end <= start:
            end = start + 5.0

    clip = ClipCandidate(
        project_id=project.id,
        title=payload.title.strip() if payload.title else "Klip Baru (Manual)",
        hook="Klip dibuat secara manual",
        rationale="Klip dipotong manual oleh pengguna melalui editor CapCut-style.",
        start_time=start,
        end_time=end,
        virality_score=80,
        category="manual",
        status="suggested",
        aspect_ratio=payload.aspect_ratio,
        subtitle_style=payload.subtitle_style,
        crop_mode=payload.crop_mode,
        auto_zoom=payload.auto_zoom,
        render_status="idle",
    )
    db.add(clip)
    db.commit()
    db.refresh(clip)

    return ClipCandidateRead.model_validate(clip)


# ── GET /api/clips ───────────────────────────────────────────────────────────

@router.get(
    "/clips",
    response_model=list[ClipCandidateRead],
    summary="List all clip candidates across all projects",
)
def list_all_clips(
    render_status: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> list[ClipCandidateRead]:
    stmt = select(ClipCandidate).order_by(desc(ClipCandidate.created_at))
    if render_status:
        stmt = stmt.where(ClipCandidate.render_status == render_status)
    stmt = stmt.limit(limit)
    clips = db.scalars(stmt).all()
    return [ClipCandidateRead.model_validate(c) for c in clips]


# ── PATCH /api/clips/{id} ────────────────────────────────────────────────────

@router.patch(
    "/clips/{clip_id}",
    response_model=ClipCandidateRead,
    summary="Update clip trim points, status, auto-zoom, or layout settings",
)
def update_clip(
    clip_id: str,
    payload: ClipCandidateUpdate,
    db: Session = Depends(get_db),
) -> ClipCandidateRead:
    clip = _get_clip_or_404(clip_id, db)

    new_start = payload.start_time if payload.start_time is not None else clip.start_time
    new_end = payload.end_time if payload.end_time is not None else clip.end_time

    if new_end <= new_start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Waktu selesai (end_time) harus lebih besar daripada waktu mulai (start_time).",
        )

    if payload.title is not None:
        clip.title = payload.title.strip()
    if payload.start_time is not None:
        clip.start_time = round(new_start, 2)
    if payload.end_time is not None:
        clip.end_time = round(new_end, 2)
    if payload.status is not None:
        clip.status = payload.status
    if payload.aspect_ratio is not None:
        clip.aspect_ratio = payload.aspect_ratio
    if payload.subtitle_style is not None:
        clip.subtitle_style = payload.subtitle_style
    if payload.crop_mode is not None:
        clip.crop_mode = payload.crop_mode
    if payload.auto_zoom is not None:
        clip.auto_zoom = payload.auto_zoom
    if payload.custom_transcript_json is not None:
        clip.custom_transcript_json = payload.custom_transcript_json
    hook_banner = payload.show_hook_banner if payload.show_hook_banner is not None else payload.intro_hook_banner
    if hook_banner is not None:
        clip.intro_hook_banner = hook_banner
    if payload.crop_x_pct is not None:
        clip.crop_x_pct = payload.crop_x_pct
    if payload.remove_silence is not None:
        clip.remove_silence = payload.remove_silence
    if payload.auto_emoji is not None:
        clip.auto_emoji = payload.auto_emoji
    if payload.bgm_track_id is not None:
        clip.bgm_track_id = payload.bgm_track_id if payload.bgm_track_id != "none" else None
    if payload.bgm_volume is not None:
        clip.bgm_volume = payload.bgm_volume
    if payload.soundboard_cues_json is not None:
        clip.soundboard_cues_json = payload.soundboard_cues_json

    db.commit()
    db.refresh(clip)

    return ClipCandidateRead.model_validate(clip)


# ── GET /api/clips/{id}/transcript ───────────────────────────────────────────

@router.get(
    "/clips/{clip_id}/transcript",
    response_model=list[ClipSubtitleSegment],
    summary="Get editable transcript subtitle segments for a clip",
)
def get_clip_transcript(
    clip_id: str,
    db: Session = Depends(get_db),
) -> list[ClipSubtitleSegment]:
    clip = _get_clip_or_404(clip_id, db)

    # 1. Prioritize saved custom transcript override
    if clip.custom_transcript_json:
        try:
            import json
            data = json.loads(clip.custom_transcript_json)
            if isinstance(data, list) and len(data) > 0:
                return [ClipSubtitleSegment(**item) for item in data]
        except Exception:
            pass

    # 2. Fallback: extract segments from project transcript overlapping this clip
    raw_segments = db.execute(
        select(TranscriptSegment)
        .where(
            TranscriptSegment.project_id == clip.project_id,
            TranscriptSegment.end_time > clip.start_time,
            TranscriptSegment.start_time < clip.end_time,
        )
        .order_by(TranscriptSegment.start_time.asc())
    ).scalars().all()

    return [
        ClipSubtitleSegment(
            id=s.id,
            segment_index=s.segment_index,
            start_time=s.start_time,
            end_time=s.end_time,
            text=s.text,
        )
        for s in raw_segments
    ]


# ── PUT /api/clips/{id}/transcript ───────────────────────────────────────────

@router.put(
    "/clips/{clip_id}/transcript",
    response_model=ClipCandidateRead,
    summary="Update custom edited transcript subtitles for a clip candidate",
)
def update_clip_transcript(
    clip_id: str,
    payload: list[ClipSubtitleSegment],
    db: Session = Depends(get_db),
) -> ClipCandidateRead:
    clip = _get_clip_or_404(clip_id, db)

    for seg in payload:
        if seg.end_time <= seg.start_time:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Setiap segmen subtitle harus memiliki end_time lebih besar dari start_time.",
            )

    import json
    data = [s.model_dump() for s in payload]
    clip.custom_transcript_json = json.dumps(data, ensure_ascii=False)
    db.commit()
    db.refresh(clip)

    return ClipCandidateRead.model_validate(clip)


# ── DELETE /api/clips/{id} ───────────────────────────────────────────────────

@router.delete(
    "/clips/{clip_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a clip candidate",
)
def delete_clip(
    clip_id: str,
    db: Session = Depends(get_db),
) -> None:
    clip = _get_clip_or_404(clip_id, db)
    db.delete(clip)
    db.commit()


# ── POST /api/clips/{id}/render ──────────────────────────────────────────────

@router.post(
    "/clips/{clip_id}/render",
    response_model=ClipRenderResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger vertical video cropping, subtitle burn-in, dynamic auto-zoom, and export render job",
)
async def trigger_render_clip(
    clip_id: str,
    payload: ClipRenderRequest = ClipRenderRequest(),
    db: Session = Depends(get_db),
) -> ClipRenderResponse:
    clip = _get_clip_or_404(clip_id, db)
    project = _get_project_or_404(clip.project_id, db)

    # Update render options on clip record only if non-None values passed
    if payload.aspect_ratio is not None:
        clip.aspect_ratio = payload.aspect_ratio
    if payload.subtitle_style is not None:
        clip.subtitle_style = payload.subtitle_style
    if payload.crop_mode is not None:
        clip.crop_mode = payload.crop_mode
    if payload.auto_zoom is not None:
        clip.auto_zoom = payload.auto_zoom

    hook_banner = payload.show_hook_banner if payload.show_hook_banner is not None else payload.intro_hook_banner
    if hook_banner is not None:
        clip.intro_hook_banner = hook_banner

    if payload.crop_x_pct is not None:
        clip.crop_x_pct = payload.crop_x_pct
    if payload.remove_silence is not None:
        clip.remove_silence = payload.remove_silence
    if payload.auto_emoji is not None:
        clip.auto_emoji = payload.auto_emoji
    if payload.bgm_track_id is not None:
        clip.bgm_track_id = payload.bgm_track_id if payload.bgm_track_id != "none" else None
    if payload.bgm_volume is not None:
        clip.bgm_volume = payload.bgm_volume

    import json
    if payload.soundboard_cues is not None:
        clip.soundboard_cues_json = json.dumps(payload.soundboard_cues)
    elif payload.soundboard_cues_json is not None:
        clip.soundboard_cues_json = payload.soundboard_cues_json

    cues_list: list[dict[str, Any]] = []
    if payload.soundboard_cues is not None:
        cues_list = payload.soundboard_cues
    elif clip.soundboard_cues_json:
        try:
            parsed = json.loads(clip.soundboard_cues_json)
            if isinstance(parsed, list):
                cues_list = parsed
        except Exception:
            cues_list = []

    clip.render_status = "rendering"

    job_params = json.dumps({
        "clip_id": clip.id,
        "aspect_ratio": clip.aspect_ratio,
        "subtitle_style": clip.subtitle_style,
        "crop_mode": clip.crop_mode,
        "auto_zoom": clip.auto_zoom,
        "intro_hook_banner": clip.intro_hook_banner,
        "show_hook_banner": clip.intro_hook_banner,
        "enable_sfx": payload.enable_sfx if payload.enable_sfx is not None else True,
        "framing_offset_pct": payload.framing_offset_pct if payload.framing_offset_pct is not None else 0.0,
        "crop_x_pct": clip.crop_x_pct,
        "remove_silence": clip.remove_silence,
        "auto_emoji": clip.auto_emoji,
        "bgm_track_id": clip.bgm_track_id,
        "bgm_volume": clip.bgm_volume,
        "soundboard_cues": cues_list,
    })

    job = Job(
        project_id=project.id,
        job_type="render_clip",
        status="pending",
        progress=0,
        params=job_params,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    await job_queue.enqueue(job.id)

    return ClipRenderResponse(
        clip_id=clip.id,
        job_id=job.id,
        message="Pekerjaan render video vertikal dan subtitle telah dijadwalkan.",
    )


# ── GET /api/clips/{id}/download ─────────────────────────────────────────────

@router.get(
    "/clips/{clip_id}/download",
    summary="Download rendered short-form MP4 video file",
)
def download_rendered_clip(
    clip_id: str,
    db: Session = Depends(get_db),
):
    clip = _get_clip_or_404(clip_id, db)

    if not clip.rendered_file_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File video hasil render belum tersedia atau belum selesai dirender.",
        )

    from pathlib import Path
    file_path = Path(clip.rendered_file_path)
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File video tidak ditemukan di server: {file_path.name}",
        )

    from fastapi.responses import FileResponse
    return FileResponse(
        path=str(file_path),
        media_type="video/mp4",
        filename=f"short_{clip_id[:8]}.mp4",
    )


# ── POST /api/clips/{id}/generate-cover ───────────────────────────────────────

@router.post(
    "/clips/{clip_id}/generate-cover",
    summary="Capture high-resolution video frame at sec 1 and burn viral hook title box into a 1080x1920 cover JPG",
)
def generate_clip_cover(
    clip_id: str,
    db: Session = Depends(get_db),
):
    clip = _get_clip_or_404(clip_id, db)
    project = _get_project_or_404(clip.project_id, db)

    if not project.file_path or not Path(project.file_path).exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File video sumber tidak ditemukan untuk membuat cover.",
        )

    # 1. Prepare target cover path in project's exports directory
    proj_dir = Path(project.file_path).parent
    exports_dir = proj_dir / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)
    cover_jpg = exports_dir / f"cover_{clip.id}.jpg"
    cover_ass = exports_dir / f"cover_{clip.id}.ass"

    # 2. Grab frame at second 1 of the clip
    seek_time = max(0.0, clip.start_time + 1.0)
    if clip.end_time - clip.start_time < 1.5:
        seek_time = clip.start_time + ((clip.end_time - clip.start_time) / 2.0)

    # 3. Create single-frame ASS subtitle for viral hook title box
    headline = (clip.title or "VIRAL HOOK").strip().replace("\n", " ").replace("\\N", " ").upper()

    ass_content = f"""[Script Info]
Title: ClipperForge Social Media Cover
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: CoverHook,Impact,56,&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,1,0,0,0,100,100,0,0,3,14,0,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 1,0:00:00.00,0:00:10.00,CoverHook,,0,0,0,,{headline}
"""
    cover_ass.write_text(ass_content, encoding="utf-8")

    from app.services.subtitle_burner import escape_ffmpeg_filter_path
    escaped_ass = escape_ffmpeg_filter_path(cover_ass)

    vf_graph = (
        f"scale=1080:1920:force_original_aspect_ratio=increase,"
        f"crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2,"
        f"ass='{escaped_ass}'"
    )

    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{seek_time:.3f}",
        "-i", str(Path(project.file_path).resolve()),
        "-vframes", "1",
        "-vf", vf_graph,
        "-q:v", "2",
        str(cover_jpg.resolve()),
    ]

    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
        if res.returncode != 0 or not cover_jpg.exists() or cover_jpg.stat().st_size == 0:
            logger.error(f"Failed to generate cover: {res.stderr}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"FFmpeg gagal menghasilkan cover JPG: {res.stderr[:200]}",
            )
    finally:
        cover_ass.unlink(missing_ok=True)

    clip.cover_file_path = str(cover_jpg)
    db.commit()

    from fastapi.responses import FileResponse
    return FileResponse(
        path=str(cover_jpg),
        media_type="image/jpeg",
        filename=f"cover_{clip_id[:8]}.jpg",
    )


# ── GET /api/clips/{id}/cover ─────────────────────────────────────────────────

@router.get(
    "/clips/{clip_id}/cover",
    summary="Download existing generated cover image JPG",
)
def get_clip_cover(
    clip_id: str,
    db: Session = Depends(get_db),
):
    clip = _get_clip_or_404(clip_id, db)
    if not clip.cover_file_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cover image belum dibuat. Panggil POST /api/clips/{id}/generate-cover terlebih dahulu.",
        )
    cover_file = Path(clip.cover_file_path)
    if not cover_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File cover tidak ditemukan di server.",
        )
    from fastapi.responses import FileResponse
    return FileResponse(
        path=str(cover_file),
        media_type="image/jpeg",
        filename=f"cover_{clip_id[:8]}.jpg",
    )


# ── POST /api/clips/{id}/analyze-title ───────────────────────────────────────

@router.post(
    "/clips/{clip_id}/analyze-title",
    response_model=TitleAnalysisResponse,
    summary="Analyze short-form clip title SEO & virality score (Rank Math style)",
)
def analyze_clip_title(
    clip_id: str,
    payload: TitleAnalysisRequest = TitleAnalysisRequest(),
    db: Session = Depends(get_db),
) -> TitleAnalysisResponse:
    clip = _get_clip_or_404(clip_id, db)
    title_to_analyze = (
        payload.title.strip()
        if (payload.title is not None and payload.title.strip())
        else clip.title
    )
    result = analyze_title_seo(title_to_analyze)
    return TitleAnalysisResponse.model_validate(result)


# ── POST /api/clips/{id}/recommend-titles ────────────────────────────────────

@router.post(
    "/clips/{clip_id}/recommend-titles",
    response_model=TitleRecommendationsResponse,
    summary="Get 3 high-SEO viral title recommendations powered by Gemini AI",
)
def recommend_clip_titles(
    clip_id: str,
    db: Session = Depends(get_db),
) -> TitleRecommendationsResponse:
    clip = _get_clip_or_404(clip_id, db)
    recommendations = generate_seo_title_recommendations(
        current_title=clip.title,
        hook=clip.hook,
        db=db,
    )
    return TitleRecommendationsResponse(
        clip_id=clip.id,
        recommendations=recommendations,
    )


# ── HELPER: Transcript Text Extractor ─────────────────────────────────────────

def _get_clip_transcript_text(clip: ClipCandidate, db: Session) -> str:
    """Extracts aggregated spoken transcript text for the given clip candidate."""
    if clip.custom_transcript_json:
        try:
            segments = json.loads(clip.custom_transcript_json)
            texts = [s.get("text", "") for s in segments if isinstance(s, dict)]
            if texts:
                return " ".join(texts)
        except Exception:
            pass

    # Fallback to project database transcript segments
    db_segs = db.scalars(
        select(TranscriptSegment)
        .where(
            TranscriptSegment.project_id == clip.project_id,
            TranscriptSegment.start_time >= max(0.0, clip.start_time - 0.5),
            TranscriptSegment.end_time <= clip.end_time + 0.5,
        )
        .order_by(TranscriptSegment.start_time)
    ).all()
    if db_segs:
        return " ".join([s.text for s in db_segs])
    return clip.title


# ── POST /api/clips/{id}/generate-social-copy ─────────────────────────────────

@router.post(
    "/clips/{clip_id}/generate-social-copy",
    response_model=SocialCopyResponse,
    summary="Generate AI viral social media captions & hashtags for TikTok, Shorts, and Reels",
)
def generate_clip_social_copy(
    clip_id: str,
    payload: SocialCopyRequest = SocialCopyRequest(),
    db: Session = Depends(get_db),
) -> SocialCopyResponse:
    clip = _get_clip_or_404(clip_id, db)
    transcript_text = _get_clip_transcript_text(clip, db)

    copies = generate_social_copy(
        title=clip.title,
        hook=clip.hook,
        rationale=clip.rationale,
        transcript_text=transcript_text,
        platform=payload.platform,
        custom_topic=payload.custom_topic,
        db=db,
    )

    # Merge with existing social copy if only one platform was regenerated
    current_copies: dict[str, Any] = {}
    if clip.social_copy_json:
        try:
            current_copies = json.loads(clip.social_copy_json)
        except Exception:
            current_copies = {}

    current_copies.update(copies)
    clip.social_copy_json = json.dumps(current_copies)
    db.commit()

    return SocialCopyResponse(
        clip_id=clip.id,
        copies={k: SocialCopyItem.model_validate(v) for k, v in copies.items()},
    )


# ── GET /api/clips/{id}/social-copy ───────────────────────────────────────────

@router.get(
    "/clips/{clip_id}/social-copy",
    response_model=SocialCopyResponse,
    summary="Get saved or auto-generated social copy for the clip",
)
def get_clip_social_copy(
    clip_id: str,
    db: Session = Depends(get_db),
) -> SocialCopyResponse:
    clip = _get_clip_or_404(clip_id, db)

    if clip.social_copy_json:
        try:
            saved_copies = json.loads(clip.social_copy_json)
            if isinstance(saved_copies, dict) and "tiktok" in saved_copies:
                return SocialCopyResponse(
                    clip_id=clip.id,
                    copies={k: SocialCopyItem.model_validate(v) for k, v in saved_copies.items()},
                )
        except Exception:
            pass

    # Auto-generate if not yet cached
    transcript_text = _get_clip_transcript_text(clip, db)
    copies = generate_social_copy(
        title=clip.title,
        hook=clip.hook,
        rationale=clip.rationale,
        transcript_text=transcript_text,
        platform="all",
        db=db,
    )
    clip.social_copy_json = json.dumps(copies)
    db.commit()

    return SocialCopyResponse(
        clip_id=clip.id,
        copies={k: SocialCopyItem.model_validate(v) for k, v in copies.items()},
    )


# ── GET /api/clips/{id}/export-kit ────────────────────────────────────────────

@router.get(
    "/clips/{clip_id}/export-kit",
    summary="Download 1-Click Publishing Kit (.zip containing MP4 video, cover JPG, and copy.txt)",
)
def download_export_kit(
    clip_id: str,
    db: Session = Depends(get_db),
):
    clip = _get_clip_or_404(clip_id, db)

    # 1. Verify rendered video exists
    if not clip.rendered_file_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Klip belum dirender. Render video MP4 terlebih dahulu sebelum mengunduh paket publishing kit.",
        )
    video_path = Path(clip.rendered_file_path)
    if not video_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File video MP4 hasil render tidak ditemukan di server.",
        )

    # 2. Get social media copy
    copies: dict[str, Any] = {}
    if clip.social_copy_json:
        try:
            copies = json.loads(clip.social_copy_json)
        except Exception:
            copies = {}
    if not copies:
        transcript_text = _get_clip_transcript_text(clip, db)
        copies = generate_social_copy(
            title=clip.title,
            hook=clip.hook,
            rationale=clip.rationale,
            transcript_text=transcript_text,
            platform="all",
            db=db,
        )
        clip.social_copy_json = json.dumps(copies)
        db.commit()

    # 3. Format social_media_copy.txt
    copy_lines = [
        "=" * 80,
        f"CLIPPERFORGE 1-CLICK PUBLISHING KIT",
        f"Judul: {clip.title}",
        f"Durasi: {clip.duration} detik | Rasio: {clip.aspect_ratio}",
        "=" * 80,
        "",
        "-" * 80,
        "[1] TIKTOK POSTING KIT",
        "-" * 80,
        copies.get("tiktok", {}).get("full_formatted_text", ""),
        "",
        "-" * 80,
        "[2] YOUTUBE SHORTS POSTING KIT",
        "-" * 80,
        copies.get("shorts", {}).get("full_formatted_text", ""),
        "",
        "-" * 80,
        "[3] INSTAGRAM REELS POSTING KIT",
        "-" * 80,
        copies.get("reels", {}).get("full_formatted_text", ""),
        "",
        "=" * 80,
        "Generated with ClipperForge Clean Zinc Workstation",
        "=" * 80,
    ]
    copy_text = "\n".join(copy_lines)

    # 4. In-memory ZIP packaging
    zip_buffer = io.BytesIO()
    clean_title = re.sub(r"[^a-zA-Z0-9_\-]", "_", clip.title)[:30] or f"clip_{clip.id[:8]}"
    
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        # Add MP4 video
        zip_file.write(video_path, arcname=f"{clean_title}_9x16.mp4")

        # Add Cover JPG if exists
        if clip.cover_file_path:
            cover_path = Path(clip.cover_file_path)
            if cover_path.exists():
                zip_file.write(cover_path, arcname=f"{clean_title}_cover.jpg")

        # Add social copy text
        zip_file.writestr(f"{clean_title}_social_copy.txt", copy_text)

    zip_buffer.seek(0)

    filename = f"ClipperForge_{clean_title}_Kit.zip"
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )


# ── Active Speaker Tracking Analysis ─────────────────────────────────────────

from pydantic import BaseModel as _PydanticBaseModel


class AnalyzeTrackingRequest(_PydanticBaseModel):
    mode: str = "active_speaker"
    crop_x_pct: float = 0.50


@router.post("/clips/{clip_id}/analyze-tracking")
def analyze_clip_tracking(
    clip_id: str,
    payload: AnalyzeTrackingRequest | None = None,
    db: Session = Depends(get_db),
):
    """
    Analyze faces, camera cuts, and speaker positions to compute active tracking
    confidence and fallback strategy without rendering full video.
    """
    clip = _get_clip_or_404(clip_id, db)
    project = _get_project_or_404(clip.project_id, db)
    source_video = Path(project.file_path)
    if not source_video.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source video file not found for project '{project.id}'.",
        )

    mode = payload.mode if payload else (clip.crop_mode or "active_speaker")
    crop_x = payload.crop_x_pct if payload else clip.crop_x_pct

    segs = db.execute(
        select(TranscriptSegment)
        .where(
            TranscriptSegment.project_id == project.id,
            TranscriptSegment.end_time >= clip.start_time,
            TranscriptSegment.start_time <= clip.end_time,
        )
        .order_by(TranscriptSegment.start_time)
    ).scalars().all()

    from app.services.speaker_tracker import track_active_speakers

    result = track_active_speakers(
        video_path=source_video,
        start_time=clip.start_time,
        end_time=clip.end_time,
        mode=mode,
        manual_crop_x_pct=crop_x,
        segments=segs,
    )

    clip.tracking_mode = result.mode
    clip.tracking_confidence = result.confidence
    clip.tracking_fallback_reason = result.fallback_reason
    db.commit()

    return {
        "clip_id": clip.id,
        "mode": result.mode,
        "confidence": result.confidence,
        "fallback_reason": result.fallback_reason,
        "detected_speakers": result.detected_speakers,
        "shot_cuts": result.shot_cuts,
        "crop_expr": result.crop_expr,
        "split_params": result.split_params,
    }


# ── Silence Removal Timeline Preview ──────────────────────────────────────────

@router.post("/clips/{clip_id}/preview-timeline")
def preview_clip_timeline(
    clip_id: str,
    db: Session = Depends(get_db),
):
    """
    Computes before/after timeline comparison for silence removal cuts
    and remapped subtitle cues without rendering video.
    """
    clip = _get_clip_or_404(clip_id, db)
    project = _get_project_or_404(clip.project_id, db)
    source_video = Path(project.file_path)

    segs = db.execute(
        select(TranscriptSegment)
        .where(
            TranscriptSegment.project_id == project.id,
            TranscriptSegment.end_time >= clip.start_time,
            TranscriptSegment.start_time <= clip.end_time,
        )
        .order_by(TranscriptSegment.start_time)
    ).scalars().all()

    from app.services.video_renderer import detect_silence_intervals
    from app.services.subtitle_burner import remap_segments_for_silence

    duration = max(0.1, clip.end_time - clip.start_time)
    silences = []
    if source_video.exists():
        try:
            silences = detect_silence_intervals(
                source_video,
                clip.start_time,
                clip.end_time,
                noise_db="-30dB",
                min_silence_duration=0.5,
            )
        except Exception as exc:
            logger.warning(f"Silence detection preview failed: {exc}")
            silences = []

    kept = []
    curr = 0.0
    for s_start, s_end in silences:
        if s_start > curr:
            kept.append((curr, s_start))
        curr = max(curr, s_end)
    if curr < duration:
        kept.append((curr, duration))

    if not kept:
        kept = [(0.0, duration)]

    rendered_duration = sum(k[1] - k[0] for k in kept)
    remapped = remap_segments_for_silence(segs, clip.start_time, kept)

    timeline_mapping = []
    acc = 0.0
    for k_s, k_e in kept:
        k_dur = k_e - k_s
        timeline_mapping.append({
            "original_start": round(clip.start_time + k_s, 2),
            "original_end": round(clip.start_time + k_e, 2),
            "rendered_start": round(acc, 2),
            "rendered_end": round(acc + k_dur, 2),
            "duration": round(k_dur, 2),
        })
        acc += k_dur

    return {
        "clip_id": clip.id,
        "original_duration": round(duration, 2),
        "rendered_duration": round(rendered_duration, 2),
        "silence_intervals_removed": [
            {
                "start": round(s[0], 2),
                "end": round(s[1], 2),
                "duration": round(s[1] - s[0], 2),
            }
            for s in silences
        ],
        "timeline_mapping": timeline_mapping,
        "remapped_segments": remapped,
    }


# ── Cover Studio Candidates & Customizer ──────────────────────────────────────

@router.get("/clips/{clip_id}/cover-candidates")
def get_cover_candidates(
    clip_id: str,
    db: Session = Depends(get_db),
):
    """
    Extracts high-sharpness candidate frames and generates transcript-grounded headlines.
    """
    clip = _get_clip_or_404(clip_id, db)
    project = _get_project_or_404(clip.project_id, db)
    source_video = Path(project.file_path)
    if not source_video.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source video file not found.",
        )

    from app.services.cover_studio import extract_candidate_frames, generate_headline_suggestions

    candidates = extract_candidate_frames(source_video, clip.start_time, clip.end_time)
    headlines = generate_headline_suggestions(clip.hook or clip.title, clip.title)

    return {
        "clip_id": clip.id,
        "candidates": [c.model_dump() for c in candidates],
        "headline_suggestions": [h.model_dump() for h in headlines],
    }


class SaveCoverRequest(_PydanticBaseModel):
    timestamp: float
    headline_text: str | None = None
    style_preset: str = "bold_amber"
    aspect_ratio: str = "9:16"
    position_y_pct: float = 0.72


@router.post("/clips/{clip_id}/save-cover")
def save_clip_cover(
    clip_id: str,
    payload: SaveCoverRequest,
    db: Session = Depends(get_db),
):
    """
    Burns headline branding and saves customized cover image.
    """
    clip = _get_clip_or_404(clip_id, db)
    project = _get_project_or_404(clip.project_id, db)
    source_video = Path(project.file_path)
    if not source_video.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source video file not found.",
        )

    cover_dir = Path(settings.STORAGE_DIR) / "projects" / project.id / "covers"
    cover_dir.mkdir(parents=True, exist_ok=True)
    cover_path = cover_dir / f"cover_{clip.id}.jpg"

    from app.services.cover_studio import render_cover_with_headline

    render_cover_with_headline(
        source_video_path=source_video,
        timestamp=payload.timestamp,
        output_path=cover_path,
        aspect_ratio=payload.aspect_ratio,
        headline_text=payload.headline_text,
        style_preset=payload.style_preset,
        position_y_pct=payload.position_y_pct,
    )

    clip.cover_file_path = str(cover_path)
    db.commit()

    return {
        "clip_id": clip.id,
        "cover_file_path": str(cover_path),
        "message": "Custom cover saved successfully.",
    }


# ── Quality Gate Inspection Report ───────────────────────────────────────────

@router.get("/clips/{clip_id}/quality-report")
def get_clip_quality_report(
    clip_id: str,
    db: Session = Depends(get_db),
):
    """
    Returns automated broadcast/social quality gate report for the rendered clip.
    """
    clip = _get_clip_or_404(clip_id, db)
    if not clip.quality_report_json:
        if clip.rendered_file_path and Path(clip.rendered_file_path).exists():
            from app.services.quality_gate import run_quality_gate

            report = run_quality_gate(
                video_path=Path(clip.rendered_file_path),
                expected_duration=clip.duration,
                expected_aspect_ratio=clip.aspect_ratio,
            )
            clip.quality_report_json = report.model_dump_json()
            db.commit()
            return report.model_dump()

        return {
            "status": "pending",
            "message": "Clip has not been rendered yet.",
            "metrics": {},
            "issues": [],
        }

    return json.loads(clip.quality_report_json)



