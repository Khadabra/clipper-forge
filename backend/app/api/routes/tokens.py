"""
routes/tokens.py — REST API endpoints for Gemini AI Token Usage Tracker & Quota Monitor.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.token import TokenSummaryResponse
from app.services.token_tracker import get_token_usage_summary

router = APIRouter(prefix="/tokens", tags=["tokens"])


@router.get(
    "/summary",
    response_model=TokenSummaryResponse,
    summary="Get today and all-time Gemini AI token usage, quota metrics, and breakdown",
)
def get_tokens_summary(
    db: Session = Depends(get_db),
) -> TokenSummaryResponse:
    """
    Returns aggregated token consumption metrics:
    - Today's tokens & request count
    - All-time tokens
    - Feature distribution breakdown ('clip_finder', 'seo_title', 'social_copy')
    - Recent invocation logs
    """
    summary = get_token_usage_summary(db)
    return TokenSummaryResponse.model_validate(summary)
