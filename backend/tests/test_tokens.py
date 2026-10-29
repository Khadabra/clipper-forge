"""
tests/test_tokens.py — Unit and integration tests for Gemini AI Token Usage Tracker & Quota Monitor.
"""
from __future__ import annotations

from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.token_usage import ApiTokenUsage
from app.services.token_tracker import (
    extract_usage_counts,
    get_token_usage_summary,
    log_gemini_usage,
)


def test_extract_usage_counts_variants():
    """Verify robust token count extraction from various response structures and mocks."""
    # 1. None response with fallback defaults
    p, c, t = extract_usage_counts(None, default_prompt=120, default_candidate=45)
    assert p == 120
    assert c == 45
    assert t == 165

    # 2. Google GenAI response object with usage_metadata attributes
    mock_meta = MagicMock()
    mock_meta.prompt_token_count = 500
    mock_meta.candidates_token_count = 150
    mock_meta.total_token_count = 650
    mock_resp = MagicMock()
    mock_resp.usage_metadata = mock_meta

    p, c, t = extract_usage_counts(mock_resp)
    assert p == 500
    assert c == 150
    assert t == 650

    # 3. Dict with usage_metadata key
    dict_resp = {
        "usage_metadata": {
            "prompt_token_count": 250,
            "candidates_token_count": 50,
            "total_token_count": 300,
        }
    }
    p, c, t = extract_usage_counts(dict_resp)
    assert p == 250
    assert c == 50
    assert t == 300


def test_log_gemini_usage_and_db_persistence(db_session: Session):
    """Verify log_gemini_usage writes records to SQLite and commits cleanly."""
    mock_meta = MagicMock()
    mock_meta.prompt_token_count = 420
    mock_meta.candidates_token_count = 80
    mock_meta.total_token_count = 500
    mock_resp = MagicMock()
    mock_resp.usage_metadata = mock_meta

    record = log_gemini_usage(
        db=db_session,
        feature_name="clip_finder",
        model_name="gemini-2.5-flash",
        response=mock_resp,
    )
    assert record is not None
    assert record.id is not None
    assert record.feature_name == "clip_finder"
    assert record.model_name == "gemini-2.5-flash"
    assert record.prompt_tokens == 420
    assert record.candidate_tokens == 80
    assert record.total_tokens == 500

    # Retrieve from DB directly
    db_item = db_session.get(ApiTokenUsage, record.id)
    assert db_item is not None
    assert db_item.total_tokens == 500


def test_token_usage_summary_calculation(db_session: Session):
    """Verify get_token_usage_summary calculates metrics, breakdown percentages, and recent logs."""
    # Add multiple token usage records
    log_gemini_usage(
        db=db_session,
        feature_name="clip_finder",
        model_name="gemini-2.5-flash",
        prompt_tokens=1000,
        candidate_tokens=200,
        total_tokens=1200,
    )
    log_gemini_usage(
        db=db_session,
        feature_name="seo_title",
        model_name="gemini-3.8-flash",
        prompt_tokens=300,
        candidate_tokens=100,
        total_tokens=400,
    )
    log_gemini_usage(
        db=db_session,
        feature_name="social_copy",
        model_name="gemini-3.8-flash",
        prompt_tokens=600,
        candidate_tokens=200,
        total_tokens=800,
    )

    summary = get_token_usage_summary(db_session)

    assert summary["today_tokens"] >= 2400
    assert summary["today_requests"] >= 3
    assert summary["all_time_tokens"] >= 2400
    assert summary["free_quota_limit"] == 1_000_000

    breakdown = summary["breakdown"]
    assert "clip_finder" in breakdown
    assert "seo_title" in breakdown
    assert "social_copy" in breakdown
    assert breakdown["clip_finder"]["tokens"] >= 1200
    assert breakdown["seo_title"]["tokens"] >= 400
    assert breakdown["social_copy"]["tokens"] >= 800

    recent_logs = summary["recent_logs"]
    assert len(recent_logs) >= 3
    assert recent_logs[0]["feature_name"] in ("clip_finder", "seo_title", "social_copy")


def test_get_tokens_summary_rest_api(client: TestClient, db_session: Session):
    """Verify GET /api/tokens/summary returns 200 OK and valid schema."""
    # Ensure at least 1 record
    log_gemini_usage(
        db=db_session,
        feature_name="social_copy",
        model_name="gemini-3.8-flash",
        prompt_tokens=150,
        candidate_tokens=50,
        total_tokens=200,
    )

    resp = client.get("/api/tokens/summary")
    assert resp.status_code == 200

    data = resp.json()
    assert "today_tokens" in data
    assert "today_requests" in data
    assert "all_time_tokens" in data
    assert "breakdown" in data
    assert "recent_logs" in data
    assert data["today_tokens"] >= 200
    assert isinstance(data["recent_logs"], list)
    assert len(data["recent_logs"]) >= 1
