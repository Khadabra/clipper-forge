"""
models/clip.py — SQLAlchemy model for AI-curated clip candidates.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ClipCandidate(Base):
    """
    Curated short-form video clip candidate recommended by Gemini AI.
    Belongs to a Project (CASCADE on delete).
    """

    __tablename__ = "clip_candidates"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    hook: Mapped[str] = mapped_column(String(512), nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)

    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)

    virality_score: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="insight")

    # Status: 'suggested' | 'approved' | 'rejected'
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="suggested")

    # Milestone 5 & 6: Export, Auto-Zoom & Subtitle Customization metadata
    rendered_file_path: Mapped[str | None] = mapped_column(
        String(512), nullable=True, default=None
    )
    aspect_ratio: Mapped[str] = mapped_column(
        String(16), nullable=False, default="9:16"
    )
    subtitle_style: Mapped[str] = mapped_column(
        String(32), nullable=False, default="condensed_clean"
    )
    crop_mode: Mapped[str] = mapped_column(
        String(32), nullable=False, default="blur_fill"
    )
    auto_zoom: Mapped[str] = mapped_column(
        String(32), nullable=False, default="subtle"
    )
    custom_transcript_json: Mapped[str | None] = mapped_column(
        Text, nullable=True, default=None
    )
    render_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="idle"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
