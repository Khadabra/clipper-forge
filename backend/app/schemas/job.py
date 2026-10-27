from __future__ import annotations

from datetime import datetime
from enum import Enum
from pydantic import BaseModel, ConfigDict, Field


class JobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobCreate(BaseModel):
    project_id: str = Field(..., description="UUID of the associated project")
    job_type: str = Field(..., description="Type of job (e.g., 'analysis', 'transcode', 'probe')")
    params: dict | None = Field(default=None, description="Optional job parameters")


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    job_type: str
    status: str
    progress: int
    error_message: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class JobCancelResponse(BaseModel):
    id: str
    status: str
    message: str
