"""
clips.py — API routes for AI-curated clip candidates management.

Endpoints:
  POST   /api/projects/{id}/find-clips  — Trigger Gemini AI clip curation job
  GET    /api/projects/{id}/clips       — List curated clip candidates
  PATCH  /api/clips/{id}                — Edit trim points (start/end) or status
  DELETE /api/clips/{id}                — Remove clip candidate
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
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
)
from app.services.job_queue import job_queue

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

    # Update render options on clip record
    clip.aspect_ratio = payload.aspect_ratio
    clip.subtitle_style = payload.subtitle_style
    clip.crop_mode = payload.crop_mode
    clip.auto_zoom = payload.auto_zoom
    clip.render_status = "rendering"

    import json
    job_params = json.dumps({
        "clip_id": clip.id,
        "aspect_ratio": payload.aspect_ratio,
        "subtitle_style": payload.subtitle_style,
        "crop_mode": payload.crop_mode,
        "auto_zoom": payload.auto_zoom,
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

