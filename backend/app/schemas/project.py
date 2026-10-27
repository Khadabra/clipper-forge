"""Pydantic schemas for the Project resource."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ProjectBase(BaseModel):
    title: str


class ProjectCreate(ProjectBase):
    """Not used directly — projects are created via file upload."""
    pass


class ProjectRead(BaseModel):
    """Full project representation returned to the client."""

    id: str
    title: str
    original_filename: str
    file_path: str
    source_url: str | None = None
    thumbnail_url: str | None = None

    duration: float | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    audio_channels: int | None = None
    file_size_bytes: int

    status: str
    created_at: datetime

    # ── Computed convenience fields ───────────────────────────────────────────
    @property
    def duration_formatted(self) -> str:
        """Return duration as MM:SS string."""
        if self.duration is None:
            return "--:--"
        total = int(self.duration)
        m, s = divmod(total, 60)
        return f"{m:02d}:{s:02d}"

    @property
    def resolution_label(self) -> str | None:
        """Return a human-friendly resolution label like '1080p FHD'."""
        if self.height is None:
            return None
        labels = {
            2160: "4K UHD",
            1440: "1440p QHD",
            1080: "1080p FHD",
            720: "720p HD",
            480: "480p SD",
        }
        for h, label in labels.items():
            if self.height >= h:
                return label
        return f"{self.height}p"

    model_config = {"from_attributes": True}


class ProjectListItem(BaseModel):
    """Compact project summary for list views."""

    id: str
    title: str
    original_filename: str
    source_url: str | None = None
    thumbnail_url: str | None = None
    duration: float | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    file_size_bytes: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class UploadResponse(BaseModel):
    """Response returned immediately after a successful upload."""

    project: ProjectRead
    message: str = "Video uploaded and metadata extracted successfully."


class YouTubeIngestRequest(BaseModel):
    """Payload to ingest a video from a YouTube URL."""

    url: str = Field(..., description="Valid YouTube URL (youtube.com or youtu.be)")


class YouTubeIngestResponse(BaseModel):
    """Response returned when a YouTube download job is initiated."""

    project_id: str
    job_id: str
    message: str = "YouTube video download queued."
    project: ProjectRead

