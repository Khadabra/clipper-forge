"""
models/clip.py — SQLAlchemy model for AI-curated clip candidates.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
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

    # Export, Auto-Zoom & Subtitle Customization metadata
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
    crop_x_pct: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.50
    )
    remove_silence: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    auto_emoji: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )

    # Active Speaker Tracking & Fallback metadata
    tracking_mode: Mapped[str] = mapped_column(
        String(32), nullable=False, default="active_speaker"
    )
    tracking_confidence: Mapped[float] = mapped_column(
        Float, nullable=False, default=1.0
    )
    tracking_fallback_reason: Mapped[str | None] = mapped_column(
        String(128), nullable=True, default=None
    )

    # Quality Gate Inspection Report JSON
    quality_report_json: Mapped[str | None] = mapped_column(
        Text, nullable=True, default=None
    )

    # Explainable AI Sub-scores & Boundary Integrity
    subscores_json: Mapped[str | None] = mapped_column(
        Text, nullable=True, default=None
    )
    starts_mid_sentence: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    ends_abruptly: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    # Intro Hook Banner (seconds 0-3) & Cover Grabber metadata
    intro_hook_banner: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    cover_file_path: Mapped[str | None] = mapped_column(
        String(512), nullable=True, default=None
    )

    # Background Music (BGM) & Auto-Ducking
    bgm_track_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, default=None
    )
    bgm_volume: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.18
    )

    # AI Social Media Copywriter JSON metadata
    social_copy_json: Mapped[str | None] = mapped_column(
        Text, nullable=True, default=None
    )

    # Meme Soundboard & Reaction SFX Cues JSON
    soundboard_cues_json: Mapped[str | None] = mapped_column(
        Text, nullable=True, default="[]"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    @property
    def duration(self) -> float:
        return max(0.0, round(self.end_time - self.start_time, 2))

    @property
    def show_hook_banner(self) -> bool:
        return self.intro_hook_banner

    @show_hook_banner.setter
    def show_hook_banner(self, value: bool) -> None:
        self.intro_hook_banner = value

