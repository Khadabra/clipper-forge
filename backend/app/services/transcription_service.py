"""
services/transcription_service.py — faster-whisper speech-to-text service.

Features:
- Smart device selection: CUDA (float16) for NVIDIA RTX GPUs with automatic CPU (int8) fallback.
- Word-level timestamps extraction.
- Timestamped segments persistence to SQLite.
- Subtitle export formatters: SRT, WebVTT, and Plain Text.
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any, Callable

# Monkeypatch av.open for PyAV >= 19.0.0 where 'metadata_errors' parameter was removed
# but faster-whisper 1.2.x still passes metadata_errors="ignore" to decode_audio.
try:
    import av
    _orig_av_open = av.open

    def _safe_av_open(*args: Any, **kwargs: Any) -> Any:
        kwargs.pop("metadata_errors", None)
        return _orig_av_open(*args, **kwargs)

    av.open = _safe_av_open
except Exception as _patch_err:
    pass

from faster_whisper import WhisperModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.transcript import TranscriptSegment

logger = logging.getLogger("clipperforge.transcription")

_MODEL_CACHE: dict[str, WhisperModel] = {}
_CACHE_LOCK = threading.Lock()


def check_cuda_available() -> bool:
    """Verify if CUDA runtime and cuBLAS DLL are present and operational on Windows."""
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() <= 0:
            return False
        import ctypes
        for dll_name in ("cublas64_12.dll", "cublas64_11.dll"):
            try:
                ctypes.CDLL(dll_name)
                return True
            except Exception:
                continue
        return False
    except Exception:
        return False


def get_optimal_device_and_compute_type() -> tuple[str, str]:
    """Detect CUDA + cuBLAS availability and return optimal (device, compute_type)."""
    if check_cuda_available():
        return "cuda", "float16"
    return "cpu", "int8"


def get_whisper_model(model_size: str = "base", force_cpu: bool = False) -> WhisperModel:
    """
    Get or load a cached WhisperModel instance with CUDA / CPU fallback.
    """
    cache_key = f"{model_size.lower().strip()}_{'cpu' if force_cpu else 'auto'}"
    with _CACHE_LOCK:
        if cache_key in _MODEL_CACHE:
            return _MODEL_CACHE[cache_key]

        device, compute_type = ("cpu", "int8") if force_cpu else get_optimal_device_and_compute_type()
        logger.info(
            f"Initializing faster-whisper model '{model_size}' on device={device}, compute_type={compute_type}"
        )

        try:
            model = WhisperModel(model_size, device=device, compute_type=compute_type)
        except Exception as exc:
            if device != "cpu":
                logger.warning(
                    f"Failed to initialize faster-whisper on {device} ({exc}). Falling back to CPU int8."
                )
                model = WhisperModel(model_size, device="cpu", compute_type="int8")
            else:
                raise

        _MODEL_CACHE[cache_key] = model
        return model


def transcribe_audio(
    audio_path: str | Path,
    model_size: str = "base",
    language: str | None = None,
    on_progress: Callable[[float], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> list[dict[str, Any]]:
    """
    Transcribe a 16kHz WAV audio file using faster-whisper.

    Parameters:
        audio_path: Path to the 16kHz WAV file.
        model_size: Whisper model size ('tiny', 'base', 'small', 'medium', 'large-v3').
        language: Optional ISO language code (e.g. 'id', 'en'). None for auto-detect.
        on_progress: Callback taking percentage (0.0 to 100.0).
        cancel_event: threading.Event to cooperatively abort.

    Returns:
        List of segment dictionaries with word timestamps.
    """
    audio_file = Path(audio_path)
    if not audio_file.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_file}")

    if cancel_event and cancel_event.is_set():
        raise Exception("Transcription cancelled by user")

    model = get_whisper_model(model_size)
    logger.info(f"Starting transcription for '{audio_file}' with model '{model_size}'")

    def _run_transcribe(m: WhisperModel) -> list[dict[str, Any]]:
        segments_gen, info = m.transcribe(
            str(audio_file),
            word_timestamps=True,
            language=language,
            vad_filter=True,  # Filter out silence
        )

        total_duration = info.duration or 0.0
        result_segments: list[dict[str, Any]] = []

        for idx, seg in enumerate(segments_gen):
            if cancel_event and cancel_event.is_set():
                raise Exception("Transcription cancelled by user")

            words = []
            if seg.words:
                for w in seg.words:
                    words.append({
                        "word": w.word,
                        "start": round(w.start, 2),
                        "end": round(w.end, 2),
                        "probability": round(w.probability, 3),
                    })

            segment_data = {
                "segment_index": idx,
                "start_time": round(seg.start, 2),
                "end_time": round(seg.end, 2),
                "text": seg.text.strip(),
                "words": words,
            }
            result_segments.append(segment_data)

            if total_duration > 0 and on_progress:
                pct = min(100.0, max(0.0, (seg.end / total_duration) * 100.0))
                on_progress(pct)

        return result_segments

    try:
        segments = _run_transcribe(model)
    except Exception as exc:
        err_msg = str(exc).lower()
        if ("cublas" in err_msg or "cuda" in err_msg or "cudnn" in err_msg) and getattr(model, "device", "") != "cpu":
            logger.warning(f"CUDA execution failed ({exc}). Retrying automatically on CPU (int8)...")
            cpu_model = get_whisper_model(model_size, force_cpu=True)
            segments = _run_transcribe(cpu_model)
        else:
            raise

    if on_progress:
        on_progress(100.0)

    logger.info(f"Transcription complete: {len(segments)} segments extracted.")
    return segments


def save_transcript_segments(
    project_id: str,
    segments: list[dict[str, Any]],
    db: Session,
) -> list[TranscriptSegment]:
    """
    Persist transcription segments to the database for a given project.
    Removes previous segments if re-transcribing.
    """
    # Remove existing segments
    existing = db.execute(
        select(TranscriptSegment).where(TranscriptSegment.project_id == project_id)
    ).scalars().all()
    for item in existing:
        db.delete(item)
    db.commit()

    created_records: list[TranscriptSegment] = []
    for seg in segments:
        rec = TranscriptSegment(
            project_id=project_id,
            segment_index=seg["segment_index"],
            start_time=seg["start_time"],
            end_time=seg["end_time"],
            text=seg["text"],
            words_json=json.dumps(seg.get("words", [])) if seg.get("words") else None,
        )
        db.add(rec)
        created_records.append(rec)

    db.commit()
    for rec in created_records:
        try:
            db.refresh(rec)
        except Exception:
            pass

    return created_records


# ── Subtitle and Text Exporters ────────────────────────────────────────────────

def _format_timestamp(seconds: float, separator: str = ",") -> str:
    """Format seconds into HH:MM:SS,mmm or HH:MM:SS.mmm."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    if millis >= 1000:
        millis = 999
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{millis:03d}"


def export_srt(segments: list[TranscriptSegment]) -> str:
    """Export transcript segments to SubRip (.srt) format."""
    lines: list[str] = []
    for idx, seg in enumerate(segments, start=1):
        start_ts = _format_timestamp(seg.start_time, separator=",")
        end_ts = _format_timestamp(seg.end_time, separator=",")
        lines.append(str(idx))
        lines.append(f"{start_ts} --> {end_ts}")
        lines.append(seg.text)
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def export_vtt(segments: list[TranscriptSegment]) -> str:
    """Export transcript segments to WebVTT (.vtt) format."""
    lines: list[str] = ["WEBVTT", ""]
    for idx, seg in enumerate(segments, start=1):
        start_ts = _format_timestamp(seg.start_time, separator=".")
        end_ts = _format_timestamp(seg.end_time, separator=".")
        lines.append(str(idx))
        lines.append(f"{start_ts} --> {end_ts}")
        lines.append(seg.text)
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def export_txt(segments: list[TranscriptSegment]) -> str:
    """Export transcript segments to human-readable plain text."""
    lines: list[str] = []
    for seg in segments:
        start_m, start_s = divmod(int(seg.start_time), 60)
        end_m, end_s = divmod(int(seg.end_time), 60)
        time_tag = f"[{start_m:02d}:{start_s:02d} - {end_m:02d}:{end_s:02d}]"
        lines.append(f"{time_tag} {seg.text}")
    return "\n".join(lines).strip() + "\n"
