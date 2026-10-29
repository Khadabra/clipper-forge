"""
conftest.py — Shared pytest fixtures for ClipForge backend test suite.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app

# Import models so their metadata is registered on Base
from app.models import project as _proj_model  # noqa: F401
from app.models import job as _job_model  # noqa: F401
from app.models import transcript as _trans_model  # noqa: F401
from app.models import clip as _clip_model  # noqa: F401
from app.models import token_usage as _token_model  # noqa: F401


@pytest.fixture(scope="function")
def db_engine():
    """
    In-memory SQLite engine using StaticPool so that all threads
    share the same connection. This is required because FastAPI runs
    sync route handlers in a threadpool — without StaticPool, each
    thread gets its own blank in-memory database.
    """
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture(scope="function")
def client(db_engine):
    """
    TestClient with a per-test in-memory SQLite DB.
    Uses FastAPI dependency override so every request uses the test DB.
    """
    from app.services.job_queue import job_queue
    from app.db.session import SessionLocal

    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    orig_factory = job_queue.session_factory
    job_queue.session_factory = TestingSession

    # raise_server_exceptions=False lets us inspect HTTP error status codes
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    job_queue.session_factory = orig_factory


@pytest.fixture(scope="function")
def db_session(db_engine):
    """Provides a dedicated SQLAlchemy session bound to the test db_engine."""
    Session = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()

