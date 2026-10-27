"""
jobs.py — API routes for background job management and real-time monitoring.

Endpoints:
  POST   /api/jobs                — Create & enqueue a new job
  GET    /api/jobs/{job_id}       — Get job status (for polling)
  POST   /api/jobs/{job_id}/cancel— Cancel a job
  GET    /api/jobs/{job_id}/events— SSE stream for real-time progress
  GET    /api/projects/{id}/jobs  — List all jobs for a project
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal, get_db
from app.models.job import Job
from app.models.project import Project
from app.schemas.job import JobCancelResponse, JobCreate, JobRead, JobStatus
from app.services.job_queue import job_queue

router = APIRouter(tags=["Jobs"])


@router.post(
    "/jobs",
    response_model=JobRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create and enqueue a new background job",
)
async def create_job(
    payload: JobCreate,
    db: Session = Depends(get_db),
) -> JobRead:
    # Verify project exists
    project = db.get(Project, payload.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project '{payload.project_id}' not found.",
        )

    job = Job(
        project_id=payload.project_id,
        job_type=payload.job_type,
        status=JobStatus.PENDING.value,
        progress=0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # Enqueue to background worker
    await job_queue.enqueue(job.id)

    return JobRead.model_validate(job)


@router.get(
    "/jobs/{job_id}",
    response_model=JobRead,
    summary="Get status and progress of a background job",
)
def get_job(
    job_id: str,
    db: Session = Depends(get_db),
) -> JobRead:
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' not found.",
        )
    return JobRead.model_validate(job)


@router.post(
    "/jobs/{job_id}/cancel",
    response_model=JobCancelResponse,
    summary="Cancel a pending or processing job",
)
def cancel_job(
    job_id: str,
    db: Session = Depends(get_db),
) -> JobCancelResponse:
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' not found.",
        )

    cancelled = job_queue.cancel(job_id, db)
    if not cancelled:
        return JobCancelResponse(
            id=job_id,
            status=job.status,
            message=f"Job is already in terminal state '{job.status}'.",
        )

    db.refresh(job)
    return JobCancelResponse(
        id=job_id,
        status=job.status,
        message="Job cancellation requested successfully.",
    )


@router.get(
    "/jobs/{job_id}/events",
    summary="Stream real-time job progress via Server-Sent Events (SSE)",
)
async def stream_job_events(job_id: str):
    """Streams job updates until terminal state is reached."""
    async def event_generator():
        last_progress = -1
        last_status = ""
        factory = getattr(job_queue, "session_factory", SessionLocal)

        while True:
            with factory() as db:
                job = db.get(Job, job_id)
                if not job:
                    yield f"event: error\ndata: {json.dumps({'error': 'Job not found'})}\n\n"
                    break

                # Send event if state or progress changed, or on first connect
                if job.progress != last_progress or job.status != last_status:
                    last_progress = job.progress
                    last_status = job.status
                    data = json.dumps({
                        "id": job.id,
                        "project_id": job.project_id,
                        "job_type": job.job_type,
                        "status": job.status,
                        "progress": job.progress,
                        "error_message": job.error_message,
                        "started_at": job.started_at.isoformat() if job.started_at else None,
                        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
                    })
                    yield f"data: {data}\n\n"

                if job.status in (
                    JobStatus.COMPLETED.value,
                    JobStatus.FAILED.value,
                    JobStatus.CANCELLED.value,
                ):
                    break

            await asyncio.sleep(0.3)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/projects/{project_id}/jobs",
    response_model=list[JobRead],
    summary="List all jobs for a specific project",
)
def list_project_jobs(
    project_id: str,
    db: Session = Depends(get_db),
) -> list[JobRead]:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project '{project_id}' not found.",
        )

    jobs = db.execute(
        select(Job).where(Job.project_id == project_id).order_by(desc(Job.created_at))
    ).scalars().all()

    return [JobRead.model_validate(j) for j in jobs]
