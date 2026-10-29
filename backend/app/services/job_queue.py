"""
services/job_queue.py — In-memory background job queue with SQLite state tracking.

Designed for local desktop workstation:
- No Redis/Celery dependency.
- Asynchronous FIFO job processing via asyncio.Queue.
- Handlers run cooperatively with cancel event and progress callbacks.
- State persisted in SQLite (Job model).
"""
from __future__ import annotations

import asyncio
import logging
import threading
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.job import Job
from app.schemas.job import JobStatus

logger = logging.getLogger("clipperforge.job_queue")

# Handler type: fn(job_id: str, set_progress: Callable[[int], None], cancel_event: threading.Event) -> None
JobHandler = Callable[[str, Callable[[int], None], threading.Event], Any]


class JobCancelledError(Exception):
    """Raised when a job is cancelled during execution."""
    pass


class JobQueue:
    def __init__(self, session_factory: Any = None) -> None:
        self._queue: asyncio.Queue[str] | None = None
        self._worker_task: asyncio.Task[None] | None = None
        self._handlers: dict[str, JobHandler] = {}
        self._cancel_events: dict[str, threading.Event] = {}
        self._running = False
        self.session_factory = session_factory or SessionLocal

    def register_handler(self, job_type: str, handler: JobHandler) -> None:
        """Register a handler function for a specific job_type."""
        self._handlers[job_type] = handler
        logger.info(f"Registered job handler for '{job_type}'")

    async def start(self) -> None:
        """Start the background worker."""
        current_loop = asyncio.get_running_loop()
        if (
            self._running
            and self._worker_task
            and not self._worker_task.done()
            and self._queue is not None
            and getattr(self._queue, "_loop", None) is current_loop
        ):
            return

        self._queue = asyncio.Queue()
        self._running = True
        self._worker_task = asyncio.create_task(self._worker_loop())
        logger.info("JobQueue background worker started")

    async def stop(self) -> None:
        """Stop the background worker cleanly."""
        self._running = False
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except (asyncio.CancelledError, Exception):
                pass
            self._worker_task = None
        self._queue = None
        logger.info("JobQueue background worker stopped")

    async def enqueue(self, job_id: str) -> None:
        """Enqueue a job ID to be processed."""
        current_loop = asyncio.get_running_loop()
        if (
            not self._running
            or self._queue is None
            or self._worker_task is None
            or self._worker_task.done()
            or getattr(self._queue, "_loop", None) is not current_loop
        ):
            # Auto-start if not running or previous worker task terminated or loop changed
            await self.start()
        assert self._queue is not None
        await self._queue.put(job_id)
        logger.info(f"Enqueued job '{job_id}'")

    def cancel(self, job_id: str, db: Session | None = None) -> bool:
        """
        Request cancellation of a job.
        If pending, immediately marks CANCELLED.
        If processing, signals the cancel event.
        """
        local_session = False
        if db is None:
            db = self.session_factory()
            local_session = True

        try:
            job = db.get(Job, job_id)
            if not job:
                return False

            if job.status in (JobStatus.COMPLETED.value, JobStatus.FAILED.value, JobStatus.CANCELLED.value):
                return False

            if job.status == JobStatus.PENDING.value:
                job.status = JobStatus.CANCELLED.value
                job.completed_at = datetime.now(timezone.utc)
                db.commit()
                return True

            # If currently processing
            if job_id in self._cancel_events:
                self._cancel_events[job_id].set()

            job.status = JobStatus.CANCELLED.value
            job.completed_at = datetime.now(timezone.utc)
            db.commit()
            return True
        finally:
            if local_session:
                db.close()

    async def _worker_loop(self) -> None:
        """Continuous consumer loop for jobs."""
        while self._running and self._queue is not None:
            try:
                job_id = await self._queue.get()
            except (asyncio.CancelledError, RuntimeError):
                break

            try:
                await self._process_job(job_id)
            except Exception as exc:
                logger.exception(f"Unhandled error processing job '{job_id}': {exc}")
            finally:
                if self._queue is not None:
                    try:
                        self._queue.task_done()
                    except Exception:
                        pass

    async def _process_job(self, job_id: str) -> None:
        """Execute a single job."""
        cancel_event = threading.Event()
        self._cancel_events[job_id] = cancel_event

        # 1. Check if job exists and is still pending
        with self.session_factory() as db:
            job = db.get(Job, job_id)
            if not job:
                self._cancel_events.pop(job_id, None)
                return

            if job.status == JobStatus.CANCELLED.value:
                self._cancel_events.pop(job_id, None)
                return

            job_type = job.job_type
            job.status = JobStatus.PROCESSING.value
            job.started_at = datetime.now(timezone.utc)
            job.progress = 0
            db.commit()

        # 2. Find handler
        handler = self._handlers.get(job_type)
        if not handler:
            with self.session_factory() as db:
                job = db.get(Job, job_id)
                if job:
                    job.status = JobStatus.FAILED.value
                    job.error_message = f"No handler registered for job type '{job_type}'"
                    job.completed_at = datetime.now(timezone.utc)
                    db.commit()
            self._cancel_events.pop(job_id, None)
            return

        # 3. Define progress reporter
        def set_progress(pct: int) -> None:
            clamped = max(0, min(100, int(pct)))
            try:
                with self.session_factory() as db:
                    j = db.get(Job, job_id)
                    if j and j.status == JobStatus.PROCESSING.value:
                        j.progress = clamped
                        db.commit()
            except Exception:
                pass

        # 4. Execute handler (in thread pool to avoid blocking async event loop)
        try:
            if cancel_event.is_set():
                raise JobCancelledError()

            await asyncio.to_thread(handler, job_id, set_progress, cancel_event)

            # Handler completed successfully
            with self.session_factory() as db:
                job = db.get(Job, job_id)
                if job:
                    if cancel_event.is_set() or job.status == JobStatus.CANCELLED.value:
                        job.status = JobStatus.CANCELLED.value
                    else:
                        job.status = JobStatus.COMPLETED.value
                        job.progress = 100
                    job.completed_at = datetime.now(timezone.utc)
                    db.commit()

        except JobCancelledError:
            with self.session_factory() as db:
                job = db.get(Job, job_id)
                if job:
                    job.status = JobStatus.CANCELLED.value
                    job.completed_at = datetime.now(timezone.utc)
                    db.commit()
        except Exception as exc:
            with self.session_factory() as db:
                job = db.get(Job, job_id)
                if job:
                    job.status = JobStatus.FAILED.value
                    job.error_message = str(exc)
                    job.completed_at = datetime.now(timezone.utc)
                    db.commit()
            logger.error(f"Job '{job_id}' failed: {exc}")
        finally:
            self._cancel_events.pop(job_id, None)


# Global job queue singleton
job_queue = JobQueue()


# ── Built-in default job handlers ──────────────────────────────────────────────

def dummy_task_handler(job_id: str, set_progress: Callable[[int], None], cancel_event: threading.Event) -> None:
    """A simulate task handler used for pipeline testing and verification."""
    import time
    for p in (10, 25, 50, 75, 90, 100):
        if cancel_event.is_set():
            raise JobCancelledError("Job cancelled by user")
        time.sleep(0.4)
        set_progress(p)


job_queue.register_handler("dummy_task", dummy_task_handler)


def youtube_download_handler(
    job_id: str,
    set_progress: Callable[[int], None],
    cancel_event: threading.Event,
) -> None:
    """Download video from YouTube, probe with ffprobe, and update Project."""
    from app.core.config import settings
    from app.models.project import Project
    from app.services.media_probe import probe
    from app.services.youtube_downloader import (
        download_youtube_video,
        get_youtube_metadata,
    )

    # 1. Fetch Job and Project info
    with job_queue.session_factory() as db:
        job = db.get(Job, job_id)
        if not job:
            return
        project = db.get(Project, job.project_id)
        if not project:
            raise ValueError(f"Project '{job.project_id}' not found.")
        url = project.source_url
        project_id = project.id

    if not url:
        raise ValueError("Project has no source_url for YouTube download.")

    if cancel_event.is_set():
        raise JobCancelledError("Job cancelled before download")

    try:
        # 2. Extract initial metadata (title, thumbnail, duration)
        set_progress(5)
        try:
            info = get_youtube_metadata(url)
            with job_queue.session_factory() as db:
                proj = db.get(Project, project_id)
                if proj:
                    if info.get("title"):
                        proj.title = info["title"]
                    if info.get("thumbnail"):
                        proj.thumbnail_url = info["thumbnail"]
                    if info.get("duration") and not proj.duration:
                        proj.duration = float(info["duration"])
                    db.commit()
        except Exception as exc:
            logger.warning(f"Could not fetch preliminary YouTube metadata: {exc}")

        if cancel_event.is_set():
            raise JobCancelledError("Job cancelled during metadata extraction")

        # 3. Download media (scaled 10% to 90%)
        set_progress(10)
        dest_dir = settings.STORAGE_DIR / "projects" / project_id
        dest_path = dest_dir / "source.mp4"

        def progress_cb(pct: float) -> None:
            scaled = 10 + int(pct * 0.8)
            set_progress(scaled)

        final_path = download_youtube_video(
            url=url,
            output_path=dest_path,
            on_progress=progress_cb,
            cancel_event=cancel_event,
        )

        if cancel_event.is_set():
            raise JobCancelledError("Job cancelled during download")

        # 4. Probe with ffprobe
        set_progress(92)
        file_size = final_path.stat().st_size
        meta = None
        try:
            meta = probe(final_path)
        except Exception as exc:
            logger.warning(f"ffprobe failed on downloaded YouTube video: {exc}")

        # 5. Persist project readiness
        with job_queue.session_factory() as db:
            proj = db.get(Project, project_id)
            if proj:
                proj.file_path = str(final_path)
                proj.file_size_bytes = file_size
                proj.status = "ready"
                if meta:
                    proj.duration = meta.get("duration") or proj.duration
                    proj.width = meta.get("width")
                    proj.height = meta.get("height")
                    proj.fps = meta.get("fps")
                    proj.audio_channels = meta.get("audio_channels")
                db.commit()

        set_progress(100)

    except JobCancelledError:
        with job_queue.session_factory() as db:
            proj = db.get(Project, project_id)
            if proj:
                proj.status = "failed"
                db.commit()
        raise
    except Exception as exc:
        with job_queue.session_factory() as db:
            proj = db.get(Project, project_id)
            if proj:
                proj.status = "failed"
                db.commit()
        raise


job_queue.register_handler("youtube_download", youtube_download_handler)


def transcribe_handler(
    job_id: str,
    set_progress: Callable[[int], None],
    cancel_event: threading.Event,
) -> None:
    """Extract audio from project video and transcribe via faster-whisper."""
    import json
    from pathlib import Path
    from app.models.project import Project
    from app.services.audio_extractor import extract_audio
    from app.services.transcription_service import (
        transcribe_audio,
        save_transcript_segments,
    )

    with job_queue.session_factory() as db:
        job = db.get(Job, job_id)
        if not job:
            raise ValueError(f"Job '{job_id}' not found in database.")
        project = db.get(Project, job.project_id)
        if not project:
            raise ValueError(f"Project '{job.project_id}' not found.")

        project_id = project.id
        video_path = Path(project.file_path)
        params = json.loads(job.params) if job.params else {}
        model_size = params.get("model_size", "base")
        language = params.get("language")

    if not video_path.exists():
        raise FileNotFoundError(f"Project video file not found at: {video_path}")

    if cancel_event.is_set():
        raise JobCancelledError("Job cancelled before audio extraction")

    try:
        # Step 1: Audio Extraction (10% - 25%)
        set_progress(10)
        audio_path = video_path.parent / "audio.wav"
        extract_audio(video_path=video_path, output_path=audio_path)
        set_progress(25)

        if cancel_event.is_set():
            raise JobCancelledError("Job cancelled after audio extraction")

        # Step 2: Transcription (25% - 95%)
        def transcription_progress_cb(pct: float) -> None:
            scaled = 25 + int(pct * 0.7)
            set_progress(scaled)

        segments = transcribe_audio(
            audio_path=audio_path,
            model_size=model_size,
            language=language,
            on_progress=transcription_progress_cb,
            cancel_event=cancel_event,
        )

        if cancel_event.is_set():
            raise JobCancelledError("Job cancelled during transcription")

        # Step 3: Save segments to SQLite and update project status to 'transcribed'
        set_progress(96)
        with job_queue.session_factory() as db:
            save_transcript_segments(project_id=project_id, segments=segments, db=db)
            proj = db.get(Project, project_id)
            if proj:
                proj.status = "transcribed"
                db.add(proj)
                db.commit()

        set_progress(100)

    except JobCancelledError:
        with job_queue.session_factory() as db:
            proj = db.get(Project, project_id)
            if proj:
                proj.status = "failed"
                db.commit()
        raise
    except Exception as exc:
        with job_queue.session_factory() as db:
            proj = db.get(Project, project_id)
            if proj:
                proj.status = "failed"
                db.commit()
        raise


job_queue.register_handler("transcribe", transcribe_handler)


def find_clips_handler(
    job_id: str,
    set_progress: Callable[[int], None],
    cancel_event: threading.Event,
) -> None:
    """Analyze project transcript using Gemini API and curate viral clip candidates."""
    from sqlalchemy import select
    from app.models.project import Project
    from app.models.transcript import TranscriptSegment
    from app.services.clip_finder import curate_clips_with_gemini, save_clip_candidates

    # 1. Fetch Job and Project
    with job_queue.session_factory() as db:
        job = db.get(Job, job_id)
        if not job:
            return
        project = db.get(Project, job.project_id)
        if not project:
            raise ValueError(f"Project '{job.project_id}' not found.")

        project_id = project.id
        duration = float(project.duration or 600.0)

        # 2. Fetch transcript segments
        segments = db.execute(
            select(TranscriptSegment)
            .where(TranscriptSegment.project_id == project_id)
            .order_by(TranscriptSegment.segment_index.asc())
        ).scalars().all()

    if not segments:
        raise ValueError(
            f"Project '{project_id}' has no transcript segments. Run transcription first."
        )

    if cancel_event.is_set():
        raise JobCancelledError("Job cancelled before clip curation")

    set_progress(15)

    # 3. Build text block for LLM prompt
    lines = []
    for s in segments:
        m_start, s_start = divmod(int(s.start_time), 60)
        m_end, s_end = divmod(int(s.end_time), 60)
        lines.append(f"[{m_start:02d}:{s_start:02d} - {m_end:02d}:{s_end:02d}] {s.text}")
    transcript_text = "\n".join(lines)

    set_progress(30)
    if cancel_event.is_set():
        raise JobCancelledError("Job cancelled during transcript preparation")

    # 4. Curate clips with Gemini AI (with heuristic fallback)
    set_progress(45)
    clips = curate_clips_with_gemini(
        transcript_text=transcript_text,
        segments=segments,
        video_duration=duration,
    )

    if cancel_event.is_set():
        raise JobCancelledError("Job cancelled during AI curation")

    set_progress(85)

    # 5. Persist candidates to SQLite
    with job_queue.session_factory() as db:
        save_clip_candidates(project_id=project_id, clips=clips, db=db)
        proj = db.get(Project, project_id)
        if proj and proj.status not in ("failed", "cancelled"):
            proj.status = "clips_ready"
            db.commit()

    set_progress(100)


job_queue.register_handler("find_clips", find_clips_handler)


def render_clip_handler(
    job_id: str,
    set_progress: Callable[[int], None],
    cancel_event: threading.Event,
) -> None:
    """
    Render 9:16 vertical cropped short video with burnt-in subtitles.
    """
    import json
    from pathlib import Path
    from app.core.config import settings
    from app.models.clip import ClipCandidate
    from app.models.job import Job
    from app.models.project import Project
    from app.models.transcript import TranscriptSegment
    from app.services.video_renderer import render_video_clip

    # 1. Fetch Job and Clip details
    with job_queue.session_factory() as db:
        job = db.get(Job, job_id)
        if not job:
            raise ValueError(f"Job '{job_id}' not found.")

        params = json.loads(job.params or "{}")
        clip_id = params.get("clip_id")
        if not clip_id:
            raise ValueError("Job parameters missing 'clip_id'.")

        clip = db.get(ClipCandidate, clip_id)
        if not clip:
            raise ValueError(f"ClipCandidate '{clip_id}' not found.")

        project = db.get(Project, clip.project_id)
        if not project:
            raise ValueError(f"Project '{clip.project_id}' not found.")

        project_id = project.id
        source_video = Path(project.file_path)
        if not source_video.exists():
            raise FileNotFoundError(f"Source video not found at '{source_video}'.")

        # Fetch transcript segments for this project and copy into dicts
        raw_segments = db.execute(
            select(TranscriptSegment)
            .where(TranscriptSegment.project_id == project_id)
            .order_by(TranscriptSegment.start_time.asc())
        ).scalars().all()
        segments = [
            {"start_time": s.start_time, "end_time": s.end_time, "text": s.text}
            for s in raw_segments
        ]

        aspect_ratio = params.get("aspect_ratio") or clip.aspect_ratio or "9:16"
        subtitle_style = params.get("subtitle_style") or clip.subtitle_style or "clean"
        crop_mode = params.get("crop_mode") or clip.crop_mode or "blur_fill"
        auto_zoom = params.get("auto_zoom") or getattr(clip, "auto_zoom", "subtle") or "subtle"
        custom_transcript_json = getattr(clip, "custom_transcript_json", None)
        headline_text = params.get("headline_text") or clip.hook or clip.title or ""
        intro_hook_banner = params.get("show_hook_banner") if params.get("show_hook_banner") is not None else params.get("intro_hook_banner")
        if intro_hook_banner is None:
            intro_hook_banner = getattr(clip, "intro_hook_banner", True)
        enable_sfx = params.get("enable_sfx", True)
        framing_offset_pct = float(params.get("framing_offset_pct", 0.0) or 0.0)
        crop_x_pct = float(params.get("crop_x_pct") if params.get("crop_x_pct") is not None else getattr(clip, "crop_x_pct", 0.50) or 0.50)
        remove_silence = bool(params.get("remove_silence") if params.get("remove_silence") is not None else getattr(clip, "remove_silence", False))
        auto_emoji = bool(params.get("auto_emoji") if params.get("auto_emoji") is not None else getattr(clip, "auto_emoji", True))
        bgm_track_id = params.get("bgm_track_id") or getattr(clip, "bgm_track_id", None)
        raw_bgm_vol = params.get("bgm_volume")
        if raw_bgm_vol is not None:
            bgm_volume = float(raw_bgm_vol)
        else:
            bgm_volume = float(getattr(clip, "bgm_volume", 0.18) or 0.18)

        soundboard_cues = params.get("soundboard_cues")
        if soundboard_cues is None and getattr(clip, "soundboard_cues_json", None):
            try:
                parsed_cues = json.loads(clip.soundboard_cues_json)
                if isinstance(parsed_cues, list):
                    soundboard_cues = parsed_cues
            except Exception:
                soundboard_cues = []
        if not isinstance(soundboard_cues, list):
            soundboard_cues = []

        clip.aspect_ratio = aspect_ratio
        clip.subtitle_style = subtitle_style
        clip.crop_mode = crop_mode
        clip.auto_zoom = auto_zoom
        clip.intro_hook_banner = intro_hook_banner
        clip.crop_x_pct = crop_x_pct
        clip.remove_silence = remove_silence
        clip.auto_emoji = auto_emoji
        clip.bgm_track_id = bgm_track_id
        clip.bgm_volume = bgm_volume
        clip.render_status = "rendering"
        db.commit()

        start_time = clip.start_time
        end_time = clip.end_time

    set_progress(10)
    if cancel_event.is_set():
        raise JobCancelledError("Render job cancelled before processing.")

    # 2. Output destination: storage/projects/{project_id}/exports/clip_{clip_id}.mp4
    output_dir = settings.STORAGE_DIR / "projects" / project_id / "exports"
    output_path = output_dir / f"clip_{clip_id}.mp4"

    # 3. Execute video renderer
    try:
        render_video_clip(
            source_video_path=source_video,
            output_path=output_path,
            start_time=start_time,
            end_time=end_time,
            aspect_ratio=aspect_ratio,
            crop_mode=crop_mode,
            subtitle_style=subtitle_style,
            auto_zoom=auto_zoom,
            segments=segments,
            custom_transcript_json=custom_transcript_json,
            headline_text=headline_text,
            intro_hook_banner=intro_hook_banner,
            enable_sfx=enable_sfx,
            framing_offset_pct=framing_offset_pct,
            crop_x_pct=crop_x_pct,
            remove_silence=remove_silence,
            auto_emoji=auto_emoji,
            bgm_track_id=bgm_track_id,
            bgm_volume=bgm_volume,
            soundboard_cues=soundboard_cues,
            set_progress=set_progress,
            cancel_event=cancel_event,
        )

        # Run automated quality gate
        try:
            from app.services.quality_gate import run_quality_gate
            q_report = run_quality_gate(
                video_path=output_path,
                expected_duration=(end_time - start_time),
                expected_aspect_ratio=aspect_ratio,
            )
            q_report_json = q_report.model_dump_json()
        except Exception as q_exc:
            logger.warning(f"Quality gate check failed: {q_exc}")
            q_report_json = None

        with job_queue.session_factory() as db:
            c = db.get(ClipCandidate, clip_id)
            if c:
                c.rendered_file_path = str(output_path)
                c.render_status = "completed"
                if q_report_json:
                    c.quality_report_json = q_report_json
                db.commit()

        set_progress(100)

    except Exception as exc:
        with job_queue.session_factory() as db:
            c = db.get(ClipCandidate, clip_id)
            if c:
                c.render_status = "failed"
                db.commit()
        raise exc


job_queue.register_handler("render_clip", render_clip_handler)




