"""
services/token_tracker.py — Gemini AI Token Usage Tracker & Quota Monitor Service.

Extracts token usage metrics from Gemini responses, logs them to SQLite database,
and aggregates daily/all-time quota consumption for the Creator Studio dashboard.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models.token_usage import ApiTokenUsage

logger = logging.getLogger(__name__)

# Daily free quota token baseline for Google Gemini Flash
GEMINI_FREE_DAILY_TOKEN_QUOTA = 1_000_000


def extract_usage_counts(
    response: Any,
    default_prompt: int = 0,
    default_candidate: int = 0,
    default_total: int = 0,
) -> tuple[int, int, int]:
    """
    Extracts (prompt_tokens, candidate_tokens, total_tokens) from various Gemini response formats.
    Compatible with google.genai, google.generativeai, dictionaries, and test mocks.
    """
    p_tokens = int(default_prompt)
    c_tokens = int(default_candidate)
    t_tokens = int(default_total)

    if response is None:
        if t_tokens == 0 and (p_tokens > 0 or c_tokens > 0):
            t_tokens = p_tokens + c_tokens
        return p_tokens, c_tokens, t_tokens

    usage = getattr(response, "usage_metadata", None)
    if usage is None and isinstance(response, dict):
        usage = response.get("usage_metadata") or response.get("usage")

    if usage is not None:
        if isinstance(usage, dict):
            p_val = usage.get("prompt_token_count") or usage.get("prompt_tokens") or usage.get("prompt")
            c_val = usage.get("candidates_token_count") or usage.get("candidates_tokens") or usage.get("candidate")
            t_val = usage.get("total_token_count") or usage.get("total_tokens") or usage.get("total")
        else:
            p_val = (
                getattr(usage, "prompt_token_count", None)
                or getattr(usage, "prompt_tokens", None)
                or getattr(usage, "prompt", None)
            )
            c_val = (
                getattr(usage, "candidates_token_count", None)
                or getattr(usage, "candidates_tokens", None)
                or getattr(usage, "candidate", None)
            )
            t_val = (
                getattr(usage, "total_token_count", None)
                or getattr(usage, "total_tokens", None)
                or getattr(usage, "total", None)
            )

        if p_val is not None:
            try:
                p_tokens = int(p_val)
            except (ValueError, TypeError):
                pass

        if c_val is not None:
            try:
                c_tokens = int(c_val)
            except (ValueError, TypeError):
                pass

        if t_val is not None:
            try:
                t_tokens = int(t_val)
            except (ValueError, TypeError):
                pass

    if t_tokens == 0 and (p_tokens > 0 or c_tokens > 0):
        t_tokens = p_tokens + c_tokens

    return p_tokens, c_tokens, t_tokens


def log_gemini_usage(
    db: Session | None,
    feature_name: str,
    model_name: str = "gemini-3.8-flash",
    response: Any = None,
    prompt_tokens: int = 0,
    candidate_tokens: int = 0,
    total_tokens: int = 0,
) -> ApiTokenUsage | None:
    """
    Persists a token usage record for a Gemini API invocation.
    If db is None, acquires a managed session via SessionLocal.
    Never raises an uncaught exception to avoid disrupting business workflows.
    """
    try:
        p_tokens, c_tokens, t_tokens = extract_usage_counts(
            response=response,
            default_prompt=prompt_tokens,
            default_candidate=candidate_tokens,
            default_total=total_tokens,
        )

        record = ApiTokenUsage(
            feature_name=feature_name,
            model_name=model_name or "gemini-3.8-flash",
            prompt_tokens=p_tokens,
            candidate_tokens=c_tokens,
            total_tokens=t_tokens,
            created_at=datetime.now(timezone.utc),
        )

        if db is not None:
            db.add(record)
            db.commit()
            db.refresh(record)
            return record

        from app.db.session import SessionLocal

        with SessionLocal() as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            return record

    except Exception as exc:
        logger.warning(f"Failed to record Gemini token usage for feature '{feature_name}': {exc}")
        return None


def get_token_usage_summary(db: Session) -> dict[str, Any]:
    """
    Calculates today's token consumption, all-time usage, and feature distribution breakdown.
    """
    now_utc = datetime.now(timezone.utc)
    today_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)

    # 1. Today metrics
    today_tokens_stmt = select(func.coalesce(func.sum(ApiTokenUsage.total_tokens), 0)).where(
        ApiTokenUsage.created_at >= today_start
    )
    today_tokens: int = db.scalar(today_tokens_stmt) or 0

    today_req_stmt = select(func.count(ApiTokenUsage.id)).where(
        ApiTokenUsage.created_at >= today_start
    )
    today_requests: int = db.scalar(today_req_stmt) or 0

    # 2. All-time metrics
    all_time_tokens_stmt = select(func.coalesce(func.sum(ApiTokenUsage.total_tokens), 0))
    all_time_tokens: int = db.scalar(all_time_tokens_stmt) or 0

    all_time_req_stmt = select(func.count(ApiTokenUsage.id))
    all_time_requests: int = db.scalar(all_time_req_stmt) or 0

    # 3. Breakdown per feature (today & all-time)
    features = ["clip_finder", "seo_title", "social_copy"]
    breakdown: dict[str, dict[str, Any]] = {}

    for f_name in features:
        f_today_tokens = db.scalar(
            select(func.coalesce(func.sum(ApiTokenUsage.total_tokens), 0)).where(
                ApiTokenUsage.created_at >= today_start,
                ApiTokenUsage.feature_name == f_name,
            )
        ) or 0
        f_today_reqs = db.scalar(
            select(func.count(ApiTokenUsage.id)).where(
                ApiTokenUsage.created_at >= today_start,
                ApiTokenUsage.feature_name == f_name,
            )
        ) or 0
        f_all_tokens = db.scalar(
            select(func.coalesce(func.sum(ApiTokenUsage.total_tokens), 0)).where(
                ApiTokenUsage.feature_name == f_name
            )
        ) or 0

        pct = round((f_today_tokens / today_tokens * 100), 1) if today_tokens > 0 else 0.0

        breakdown[f_name] = {
            "tokens": f_today_tokens,
            "requests": f_today_reqs,
            "all_time_tokens": f_all_tokens,
            "percentage": pct,
        }

    # 4. Recent logs (last 10 items)
    recent_records = db.scalars(
        select(ApiTokenUsage).order_by(desc(ApiTokenUsage.created_at)).limit(10)
    ).all()

    recent_logs = [
        {
            "id": r.id,
            "feature_name": r.feature_name,
            "model_name": r.model_name,
            "prompt_tokens": r.prompt_tokens,
            "candidate_tokens": r.candidate_tokens,
            "total_tokens": r.total_tokens,
            "created_at": r.created_at.isoformat(),
        }
        for r in recent_records
    ]

    quota_used_pct = round((today_tokens / GEMINI_FREE_DAILY_TOKEN_QUOTA) * 100, 2)

    return {
        "today_tokens": today_tokens,
        "today_requests": today_requests,
        "all_time_tokens": all_time_tokens,
        "all_time_requests": all_time_requests,
        "free_quota_limit": GEMINI_FREE_DAILY_TOKEN_QUOTA,
        "quota_used_percent": quota_used_pct,
        "breakdown": breakdown,
        "recent_logs": recent_logs,
    }
