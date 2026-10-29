"""
models/token_usage.py — SQLAlchemy model for tracking Gemini AI token usage and quota metrics.
"""
from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ApiTokenUsage(Base):
    """
    Records per-request token consumption for Gemini API calls across features:
    - 'clip_finder': Viral clip candidate discovery & semantic curation
    - 'seo_title': Title recommendation & viral headline generation
    - 'social_copy': AI social media publishing suite (TikTok/Shorts/Reels)
    """

    __tablename__ = "api_token_usages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    feature_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    model_name: Mapped[str] = mapped_column(String(64), nullable=False, default="gemini-3.8-flash")

    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    candidate_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
