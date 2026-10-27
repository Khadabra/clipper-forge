"""
schemas/clip.py — Pydantic schemas for AI-curated clip candidates & export pipeline.
"""
from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class ClipSubtitleSegment(BaseModel):
    """Timestamped segment representing an editable line of subtitle in a clip."""
    start_time: float = Field(..., ge=0.0)
    end_time: float = Field(..., ge=0.0)
    text: str = Field(..., min_length=1)
    id: str | None = None
    segment_index: int | None = None
    speaker_label: str | None = None


class ClipCandidateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    title: str
    hook: str
    rationale: str
    start_time: float
    end_time: float
    virality_score: int
    category: str
    status: str
    rendered_file_path: str | None = None
    aspect_ratio: str = "9:16"
    subtitle_style: str = "condensed_clean"
    crop_mode: str = "blur_fill"
    auto_zoom: str = "subtle"
    custom_transcript_json: str | None = None
    render_status: str = "idle"
    created_at: datetime

    @property
    def duration(self) -> float:
        return max(0.0, round(self.end_time - self.start_time, 2))


class ClipCandidateUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    start_time: float | None = Field(default=None, ge=0.0)
    end_time: float | None = Field(default=None, ge=0.0)
    status: str | None = Field(default=None, pattern="^(suggested|approved|rejected)$")
    aspect_ratio: str | None = Field(default=None, pattern="^(9:16|1:1|16:9)$")
    subtitle_style: str | None = Field(
        default=None,
        pattern="^(hormozi|condensed_clean|boxed_vox|cyber_neon|word_highlight|none)$",
    )
    crop_mode: str | None = Field(
        default=None,
        pattern="^(blur_fill|center_crop|framed_headline|speaker_track)$",
    )
    auto_zoom: str | None = Field(
        default=None,
        pattern="^(none|subtle|snap_hook)$",
    )
    custom_transcript_json: str | None = None


class FindClipsResponse(BaseModel):
    project_id: str
    job_id: str
    message: str = "AI Clip Finder job queued successfully."


class ClipListResponse(BaseModel):
    project_id: str
    total_clips: int
    clips: list[ClipCandidateRead]


class ClipRenderRequest(BaseModel):
    aspect_ratio: str = Field(default="9:16", pattern="^(9:16|1:1|16:9)$")
    subtitle_style: str = Field(
        default="condensed_clean",
        pattern="^(hormozi|condensed_clean|boxed_vox|cyber_neon|word_highlight|none)$",
    )
    crop_mode: str = Field(
        default="blur_fill",
        pattern="^(blur_fill|center_crop|framed_headline|speaker_track)$",
    )
    auto_zoom: str = Field(
        default="subtle",
        pattern="^(none|subtle|snap_hook)$",
    )


class ClipRenderResponse(BaseModel):
    clip_id: str
    job_id: str
    message: str = "Rendering job scheduled successfully."
