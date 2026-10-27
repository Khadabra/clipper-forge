"""
projects.py — API routes for video project management.

Endpoints:
  POST   /api/projects/upload   — multipart upload + ffprobe + DB persist
  GET    /api/projects           — list all projects (newest first)
  GET    /api/projects/{id}      — single project detail
  DELETE /api/projects/{id}      — delete project + storage files
"""
from __future__ import annotations

import uuid
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.job import Job
from app.models.project import Project
from app.schemas.project import (
    ProjectListItem,
    ProjectRead,
    UploadResponse,
    YouTubeIngestRequest,
    YouTubeIngestResponse,
)
from app.services.job_queue import job_queue
from app.services.media_probe import MediaProbeError, probe
from app.services.youtube_downloader import is_valid_youtube_url

router = APIRouter(prefix="/projects", tags=["Projects"])

# Allowed MIME types / extensions
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".avi"}
CHUNK_SIZE = 1024 * 1024  # 1 MB streaming chunks


def _project_dir(project_id: str) -> Path:
    return settings.STORAGE_DIR / "projects" / project_id


def _get_project_or_404(project_id: str, db: Session) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project '{project_id}' not found.",
        )
    return project


# ── POST /projects/upload ────────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=UploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a video file and extract metadata",
)
async def upload_project(
    file: UploadFile = File(..., description="Video file (.mp4 .mov .mkv .webm .avi)"),
    db: Session = Depends(get_db),
) -> UploadResponse:
    # ── Validate extension ────────────────────────────────────────────────────
    original_name = file.filename or "unknown"
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"File type '{suffix}' is not supported. "
                f"Accepted: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            ),
        )

    # ── Allocate project ID + storage path ───────────────────────────────────
    project_id = str(uuid.uuid4())
    project_dir = _project_dir(project_id)
    project_dir.mkdir(parents=True, exist_ok=True)
    dest_path = project_dir / "source.mp4"

    # ── Stream file to disk (RAM-efficient, chunked) ─────────────────────────
    try:
        with dest_path.open("wb") as out:
            while chunk := await file.read(CHUNK_SIZE):
                out.write(chunk)
    except OSError as exc:
        shutil.rmtree(project_dir, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save uploaded file: {exc}",
        )

    file_size = dest_path.stat().st_size

    # ── Run ffprobe ───────────────────────────────────────────────────────────
    try:
        meta = probe(dest_path)
        probe_status = "ready"
    except (MediaProbeError, FileNotFoundError) as exc:
        # Don't delete the file — keep the project in 'failed' state
        meta = None
        probe_status = "failed"
        probe_error = str(exc)
    else:
        probe_error = None

    # ── Derive human-readable title from filename ─────────────────────────────
    title = Path(original_name).stem.replace("_", " ").replace("-", " ").strip()
    if not title:
        title = project_id[:8]

    # ── Persist to SQLite ─────────────────────────────────────────────────────
    project = Project(
        id=project_id,
        title=title,
        original_filename=original_name,
        file_path=str(dest_path),
        duration=meta["duration"] if meta else None,
        width=meta["width"] if meta else None,
        height=meta["height"] if meta else None,
        fps=meta["fps"] if meta else None,
        audio_channels=meta["audio_channels"] if meta else None,
        file_size_bytes=file_size,
        status=probe_status,
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    if probe_status == "failed":
        # Return 422 with partial project info
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "File saved but metadata extraction failed.",
                "error": probe_error,
                "project_id": project_id,
            },
        )

    return UploadResponse(
        project=ProjectRead.model_validate(project),
        message="Video uploaded and metadata extracted successfully.",
    )


# ── POST /projects/youtube ───────────────────────────────────────────────────

@router.post(
    "/youtube",
    response_model=YouTubeIngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest video from a YouTube URL",
)
async def ingest_youtube_project(
    payload: YouTubeIngestRequest,
    db: Session = Depends(get_db),
) -> YouTubeIngestResponse:
    url = payload.url.strip()
    if not is_valid_youtube_url(url):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL YouTube tidak valid. Harap masukkan tautan youtube.com atau youtu.be yang benar.",
        )

    project_id = str(uuid.uuid4())
    project_dir = _project_dir(project_id)
    project_dir.mkdir(parents=True, exist_ok=True)
    dest_path = project_dir / "source.mp4"

    # Create initial project record with 'downloading' status
    project = Project(
        id=project_id,
        title="Mengunduh Video YouTube...",
        original_filename=url,
        file_path=str(dest_path),
        source_url=url,
        status="downloading",
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    # Create & enqueue background job
    job = Job(
        project_id=project_id,
        job_type="youtube_download",
        status="pending",
        progress=0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    await job_queue.enqueue(job.id)

    return YouTubeIngestResponse(
        project_id=project.id,
        job_id=job.id,
        message="Unduhan video YouTube telah dijadwalkan.",
        project=ProjectRead.model_validate(project),
    )



# ── GET /projects ─────────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=list[ProjectListItem],
    summary="List all uploaded projects",
)
def list_projects(
    db: Session = Depends(get_db),
) -> list[ProjectListItem]:
    from sqlalchemy import select, desc

    projects = db.execute(
        select(Project).order_by(desc(Project.created_at))
    ).scalars().all()

    return [ProjectListItem.model_validate(p) for p in projects]


# ── GET /projects/{id} ───────────────────────────────────────────────────────

@router.get(
    "/{project_id}",
    response_model=ProjectRead,
    summary="Get full project metadata",
)
def get_project(
    project_id: str,
    db: Session = Depends(get_db),
) -> ProjectRead:
    project = _get_project_or_404(project_id, db)
    return ProjectRead.model_validate(project)


# ── DELETE /projects/{id} ────────────────────────────────────────────────────

@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a project and its storage files",
)
def delete_project(
    project_id: str,
    db: Session = Depends(get_db),
) -> None:
    project = _get_project_or_404(project_id, db)

    # Remove files from disk
    project_dir = _project_dir(project_id)
    if project_dir.exists():
        shutil.rmtree(project_dir, ignore_errors=True)

    db.delete(project)
    db.commit()
