from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.core.config import settings
from app.db.base import Base

# ── Ensure storage directory exists ─────────────────────────────────────────
settings.STORAGE_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = settings.STORAGE_DIR / "clipforge.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # needed for SQLite + FastAPI threads
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _migrate_columns(db_engine) -> None:
    from sqlalchemy import text
    try:
        with db_engine.connect() as conn:
            # 1. Migrate projects table
            p_res = conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
            ).fetchone()
            if p_res:
                p_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(projects)")).fetchall()]
                if "source_url" not in p_cols:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN source_url VARCHAR(512)"))
                if "thumbnail_url" not in p_cols:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN thumbnail_url VARCHAR(512)"))

            # 2. Migrate jobs table
            j_res = conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'")
            ).fetchone()
            if j_res:
                j_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(jobs)")).fetchall()]
                if "params" not in j_cols:
                    conn.execute(text("ALTER TABLE jobs ADD COLUMN params TEXT"))

            # 3. Migrate clip_candidates table
            c_res = conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name='clip_candidates'")
            ).fetchone()
            if c_res:
                columns = [row[1] for row in conn.execute(text("PRAGMA table_info(clip_candidates)")).fetchall()]
                if "rendered_file_path" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN rendered_file_path VARCHAR(512)"))
                if "aspect_ratio" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN aspect_ratio VARCHAR(16) DEFAULT '9:16'"))
                if "subtitle_style" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN subtitle_style VARCHAR(32) DEFAULT 'clean'"))
                if "crop_mode" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN crop_mode VARCHAR(32) DEFAULT 'blur_fill'"))
                if "auto_zoom" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN auto_zoom VARCHAR(32) DEFAULT 'subtle'"))
                if "custom_transcript_json" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN custom_transcript_json TEXT"))
                if "render_status" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN render_status VARCHAR(32) DEFAULT 'idle'"))

            conn.commit()
    except Exception:
        pass


def init_db() -> None:
    """Create all tables if they don't exist yet and ensure schema updates."""
    from app.models import project, job, transcript, clip  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _migrate_columns(engine)


def get_db():
    """FastAPI dependency: yields a database session and ensures cleanup."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
