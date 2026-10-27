"""
tests/test_jobs.py — Tests for background Job Queue and Job Endpoints.
"""
from __future__ import annotations

import asyncio
import time
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.job import Job
from app.models.project import Project
from app.services.job_queue import job_queue, JobCancelledError


@pytest.fixture
def sample_project(db_engine):
    """Create a sample project in the test database."""
    with Session(db_engine) as session:
        proj = Project(
            id="proj-job-test-123",
            title="Job Test Video",
            original_filename="sample.mp4",
            file_path="storage/projects/proj-job-test-123/source.mp4",
            file_size_bytes=1024,
            status="ready",
        )
        session.add(proj)
        session.commit()
    return "proj-job-test-123"


def test_create_job(client: TestClient, sample_project: str):
    response = client.post(
        "/api/jobs",
        json={"project_id": sample_project, "job_type": "dummy_task"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["project_id"] == sample_project
    assert data["job_type"] == "dummy_task"
    assert data["status"] in ("pending", "processing", "completed")
    assert "id" in data


def test_create_job_nonexistent_project(client: TestClient):
    response = client.post(
        "/api/jobs",
        json={"project_id": "nonexistent-id", "job_type": "dummy_task"},
    )
    assert response.status_code == 404


def test_get_job_not_found(client: TestClient):
    response = client.get("/api/jobs/missing-job-id")
    assert response.status_code == 404


def test_get_job_success(client: TestClient, sample_project: str):
    create_resp = client.post(
        "/api/jobs",
        json={"project_id": sample_project, "job_type": "dummy_task"},
    )
    job_id = create_resp.json()["id"]

    get_resp = client.get(f"/api/jobs/{job_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == job_id


def test_cancel_job(client: TestClient, sample_project: str):
    create_resp = client.post(
        "/api/jobs",
        json={"project_id": sample_project, "job_type": "dummy_task"},
    )
    job_id = create_resp.json()["id"]

    cancel_resp = client.post(f"/api/jobs/{job_id}/cancel")
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "cancelled"

    # Verify status in get
    get_resp = client.get(f"/api/jobs/{job_id}")
    assert get_resp.json()["status"] == "cancelled"


def test_cancel_job_not_found(client: TestClient):
    response = client.post("/api/jobs/random-bad-id/cancel")
    assert response.status_code == 404


def test_unknown_job_type_fails(client: TestClient, sample_project: str):
    # Enqueue a job with unknown handler
    create_resp = client.post(
        "/api/jobs",
        json={"project_id": sample_project, "job_type": "unknown_type_xyz"},
    )
    job_id = create_resp.json()["id"]

    import time
    for _ in range(100):
        j_resp = client.get(f"/api/jobs/{job_id}")
        if j_resp.status_code == 200 and j_resp.json()["status"] in ("completed", "failed", "cancelled"):
            break
        time.sleep(0.05)

    get_resp = client.get(f"/api/jobs/{job_id}")
    data = get_resp.json()
    assert data["status"] == "failed"
    assert "No handler registered" in data["error_message"]


def test_list_project_jobs(client: TestClient, sample_project: str):
    client.post(
        "/api/jobs",
        json={"project_id": sample_project, "job_type": "dummy_task"},
    )
    response = client.get(f"/api/projects/{sample_project}/jobs")
    assert response.status_code == 200
    jobs = response.json()
    assert len(jobs) >= 1
    assert jobs[0]["project_id"] == sample_project


def test_sse_stream_events(client: TestClient, sample_project: str):
    create_resp = client.post(
        "/api/jobs",
        json={"project_id": sample_project, "job_type": "dummy_task"},
    )
    job_id = create_resp.json()["id"]

    # Directly set to completed so stream closes fast
    client.post(f"/api/jobs/{job_id}/cancel")

    response = client.get(f"/api/jobs/{job_id}/events")
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    assert "data:" in response.text
