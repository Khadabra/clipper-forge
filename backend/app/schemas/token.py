"""
schemas/token.py — Pydantic models for Gemini AI Token Usage Tracker & Quota Monitor.
"""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class TokenLogItem(BaseModel):
    id: int
    feature_name: str
    model_name: str
    prompt_tokens: int
    candidate_tokens: int
    total_tokens: int
    created_at: str


class FeatureBreakdownItem(BaseModel):
    tokens: int = 0
    requests: int = 0
    all_time_tokens: int = 0
    percentage: float = 0.0


class TokenSummaryResponse(BaseModel):
    today_tokens: int = Field(0, description="Total tokens consumed today (UTC)")
    today_requests: int = Field(0, description="Total API requests performed today")
    all_time_tokens: int = Field(0, description="All-time token consumption")
    all_time_requests: int = Field(0, description="All-time API requests count")
    free_quota_limit: int = Field(1_000_000, description="Daily free tier quota reference")
    quota_used_percent: float = Field(0.0, description="Percentage of free quota consumed today")
    breakdown: dict[str, FeatureBreakdownItem] = Field(default_factory=dict)
    recent_logs: list[TokenLogItem] = Field(default_factory=list)
