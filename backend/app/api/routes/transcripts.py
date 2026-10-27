"""
transcripts.py — API endpoints for video transcription and subtitle export.

Endpoints:
  POST /api/projects/{id}/transcribe
  GET  /api/projects/{id}/transcript
  GET  /api/projects/{id}/transcript/export?format=srt|vtt|txt
"""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.job import Job
from app.models.project import Project
from app.models.transcript import TranscriptSegment
from app.schemas.transcript import (
    TranscribeRequest,
    TranscribeResponse,
    TranscriptListResponse,
    TranscriptSegmentRead,
)
from app.services.job_queue import job_queue
from app.services.transcription_service import (
    export_srt,
    export_txt,
    export_vtt,
)

router = APIRouter(prefix="/projects", tags=["Transcripts"])


def _get_project_or_404(project_id: str, db: Session) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project '{project_id}' not found.",
        )
    return project


# ── POST /api/projects/{id}/transcribe ───────────────────────────────────────

@router.post(
    "/{project_id}/transcribe",
    response_model=TranscribeResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger audio extraction and faster-whisper transcription job",
)
async def trigger_transcription(
    project_id: str,
    payload: TranscribeRequest = TranscribeRequest(),
    db: Session = Depends(get_db),
) -> TranscribeResponse:
    project = _get_project_or_404(project_id, db)

    video_path = Path(project.file_path)
    if not video_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Source video file not found at '{video_path}'. Ensure video upload is complete.",
        )

    # Persist job parameters
    job_params = json.dumps({
        "model_size": payload.model_size,
        "language": payload.language,
    })

    job = Job(
        project_id=project_id,
        job_type="transcribe",
        status="pending",
        progress=0,
        params=job_params,
    )
    db.add(job)

    project.status = "transcribing"
    db.commit()
    db.refresh(job)

    # Enqueue in background worker
    await job_queue.enqueue(job.id)

    return TranscribeResponse(
        project_id=project_id,
        job_id=job.id,
        message="Pekerjaan transkripsi telah dijadwalkan.",
        model_size=payload.model_size,
    )


# ── GET /api/projects/{id}/transcript ─────────────────────────────────────────

@router.get(
    "/{project_id}/transcript",
    response_model=TranscriptListResponse,
    summary="Fetch all transcription segments for a project",
)
def get_project_transcript(
    project_id: str,
    db: Session = Depends(get_db),
) -> TranscriptListResponse:
    _get_project_or_404(project_id, db)

    segments = db.execute(
        select(TranscriptSegment)
        .where(TranscriptSegment.project_id == project_id)
        .order_by(TranscriptSegment.segment_index.asc())
    ).scalars().all()

    items = [TranscriptSegmentRead.model_validate(s) for s in segments]
    return TranscriptListResponse(
        project_id=project_id,
        total_segments=len(items),
        segments=items,
    )


# ── GET /api/projects/{id}/transcript/export ──────────────────────────────────

@router.get(
    "/{project_id}/transcript/export",
    summary="Export transcript segments as SRT, VTT, or TXT format",
)
def export_project_transcript(
    project_id: str,
    format: str = Query(
        "srt",
        description="Subtitle or document export format (srt, vtt, or txt)",
        pattern="^(srt|vtt|txt)$",
    ),
    db: Session = Depends(get_db),
) -> Response:
    project = _get_project_or_404(project_id, db)

    segments = db.execute(
        select(TranscriptSegment)
        .where(TranscriptSegment.project_id == project_id)
        .order_by(TranscriptSegment.segment_index.asc())
    ).scalars().all()

    if not segments:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transkrip belum tersedia untuk proyek ini. Jalankan proses transkripsi terlebih dahulu.",
        )

    # Sanitize title for filename
    safe_title = "".join(c for c in project.title if c.isalnum() or c in (" ", "-", "_")).strip() or project_id[:8]

    fmt = format.lower().strip()
    if fmt == "srt":
        content = export_srt(segments)
        media_type = "application/x-subrip; charset=utf-8"
        filename = f"{safe_title}.srt"
    elif fmt == "vtt":
        content = export_vtt(segments)
        media_type = "text/vtt; charset=utf-8"
        filename = f"{safe_title}.vtt"
    else:  # txt
        content = export_txt(segments)
        media_type = "text/plain; charset=utf-8"
        filename = f"{safe_title}.txt"

    # RFC 5987 encoded content-disposition
    encoded_fn = quote(filename)
    headers = {
        "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{encoded_fn}",
    }

    return Response(content=content, media_type=media_type, headers=headers)
