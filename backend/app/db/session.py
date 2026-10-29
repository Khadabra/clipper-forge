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
                if "intro_hook_banner" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN intro_hook_banner BOOLEAN DEFAULT 1"))
                if "cover_file_path" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN cover_file_path VARCHAR(512)"))
                if "bgm_track_id" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN bgm_track_id VARCHAR(64)"))
                if "bgm_volume" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN bgm_volume FLOAT DEFAULT 0.18"))
                if "social_copy_json" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN social_copy_json TEXT"))
                if "soundboard_cues_json" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN soundboard_cues_json TEXT DEFAULT '[]'"))
                if "crop_x_pct" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN crop_x_pct FLOAT DEFAULT 0.50"))
                if "remove_silence" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN remove_silence BOOLEAN DEFAULT 0"))
                if "auto_emoji" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN auto_emoji BOOLEAN DEFAULT 1"))
                if "tracking_mode" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN tracking_mode VARCHAR(32) DEFAULT 'active_speaker'"))
                if "tracking_confidence" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN tracking_confidence FLOAT DEFAULT 1.0"))
                if "tracking_fallback_reason" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN tracking_fallback_reason VARCHAR(128)"))
                if "quality_report_json" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN quality_report_json TEXT"))
                if "subscores_json" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN subscores_json TEXT"))
                if "starts_mid_sentence" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN starts_mid_sentence BOOLEAN DEFAULT 0"))
                if "ends_abruptly" not in columns:
                    conn.execute(text("ALTER TABLE clip_candidates ADD COLUMN ends_abruptly BOOLEAN DEFAULT 0"))

            # 4. Migrate / ensure api_token_usages table
            t_res = conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name='api_token_usages'")
            ).fetchone()
            if not t_res:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS api_token_usages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        feature_name VARCHAR(64) NOT NULL,
                        model_name VARCHAR(64) NOT NULL DEFAULT 'gemini-3.8-flash',
                        prompt_tokens INTEGER NOT NULL DEFAULT 0,
                        candidate_tokens INTEGER NOT NULL DEFAULT 0,
                        total_tokens INTEGER NOT NULL DEFAULT 0,
                        created_at DATETIME NOT NULL
                    )
                """))

            conn.commit()
    except Exception as exc:
        import logging
        logging.getLogger("app.db.session").warning("Database migration exception: %s", exc)


_db_initialized = False


def init_db() -> None:
    """Create all tables if they don't exist yet and ensure schema updates."""
    global _db_initialized
    from app.models import project, job, transcript, clip, token_usage  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _migrate_columns(engine)
    _db_initialized = True


# Run init_db on module import to ensure local databases are immediately migrated
init_db()


def get_db():
    """FastAPI dependency: yields a database session and ensures cleanup."""
    if not _db_initialized:
        init_db()
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
