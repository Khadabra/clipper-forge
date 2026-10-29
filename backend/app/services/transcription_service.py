"""
services/transcription_service.py — faster-whisper speech-to-text service.

Features:
- Smart device selection: CUDA (float16) for NVIDIA RTX GPUs with automatic CPU (int8) fallback.
- Windows CUDA 12 runtime DLL auto-registration from nvidia-cublas and nvidia-cudnn packages.
- Anti-hallucination & anti-looping safeguards (repetition_penalty, condition_on_previous_text=False).
- Deduplication Sanitizer: automatically trims repeating words/phrases (> 2 consecutive occurrences).
- Word-level timestamps extraction.
- VAD filtering (Voice Activity Detection) with silence skipping for ultra-fast processing.
- Automatic 16kHz mono WAV pre-extraction via FFmpeg.
- Timestamped segments persistence to SQLite.
- Subtitle export formatters: SRT, WebVTT, and Plain Text.
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
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

logger = logging.getLogger("clipperforge.transcription")


def sanitize_repetitions(text: str) -> str:
    """
    Deduplication Sanitizer:
    Detects and trims words or phrases that repeat more than 2 times consecutively.
    e.g. 'baru baru baru baru baru' -> 'baru baru'
    'ngebaru-ngebaru-ngebaru' -> 'ngebaru-ngebaru'
    'bisa jadi bisa jadi bisa jadi bisa jadi' -> 'bisa jadi bisa jadi'
    """
    if not text or not text.strip():
        return text

    cleaned = text.strip()

    # 1. Hyphenated word repetition e.g. "ngebaru-ngebaru-ngebaru" or "baru-baru-baru-baru"
    cleaned = re.sub(r'(\b\w+)(?:-\1){2,}', r'\1-\1', cleaned, flags=re.IGNORECASE)

    # 2. Token-level consecutive phrase duplication (from 4 words down to 1 word)
    tokens = re.findall(r'\S+', cleaned)
    if len(tokens) <= 2:
        return cleaned

    for k in (4, 3, 2, 1):
        i = 0
        new_tokens = []
        while i < len(tokens):
            phrase = tokens[i : i + k]
            if len(phrase) < k:
                new_tokens.extend(tokens[i:])
                break

            count = 1
            j = i + k
            clean_phrase = [t.lower().strip(".,!?:;\"'()[]{}") for t in phrase]
            while (
                j + k <= len(tokens)
                and [t.lower().strip(".,!?:;\"'()[]{}") for t in tokens[j : j + k]] == clean_phrase
            ):
                count += 1
                j += k

            if count > 2:
                # Keep only 2 occurrences
                new_tokens.extend(tokens[i : i + 2 * k])
                i = j
            else:
                new_tokens.append(tokens[i])
                i += 1
        tokens = new_tokens

    return " ".join(tokens)


def register_cuda_dll_directories() -> list[str]:
    """
    On Windows, register nvidia pip package DLL directories (cublas, cudnn, nvrtc)
    with os.add_dll_directory() so ctranslate2 and ctypes can load CUDA 12 runtime DLLs
    without requiring a full system CUDA Toolkit installation.
    """
    added_paths: list[str] = []
    if sys.platform != "win32":
        return added_paths

    candidate_roots: set[Path] = set()
    try:
        import site
        for p in site.getsitepackages():
            candidate_roots.add(Path(p))
    except Exception:
        pass
    for p in sys.path:
        if "site-packages" in p:
            candidate_roots.add(Path(p))

    prefix_sp = Path(sys.prefix) / "Lib" / "site-packages"
    if prefix_sp.is_dir():
        candidate_roots.add(prefix_sp)

    for base in candidate_roots:
        nvidia_dir = base / "nvidia"
        if nvidia_dir.is_dir():
            for subpkg in nvidia_dir.iterdir():
                if subpkg.is_dir():
                    for subfolder in ("bin", "lib"):
                        candidate = subpkg / subfolder
                        if candidate.is_dir():
                            c_str = str(candidate.resolve())
                            try:
                                os.add_dll_directory(c_str)
                                if c_str not in os.environ.get("PATH", ""):
                                    os.environ["PATH"] = c_str + os.pathsep + os.environ.get("PATH", "")
                                if c_str not in added_paths:
                                    added_paths.append(c_str)
                            except Exception as exc:
                                logger.debug(f"Failed to add DLL directory {candidate}: {exc}")

    # Also register CUDA_PATH if present in system environment
    cuda_path = os.environ.get("CUDA_PATH")
    if cuda_path:
        cuda_bin = Path(cuda_path) / "bin"
        if cuda_bin.is_dir():
            c_str = str(cuda_bin.resolve())
            try:
                os.add_dll_directory(c_str)
                if c_str not in added_paths:
                    added_paths.append(c_str)
            except Exception:
                pass

    return added_paths


# Register DLL directories immediately at module load time
_REGISTERED_CUDA_PATHS = register_cuda_dll_directories()

from faster_whisper import WhisperModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.transcript import TranscriptSegment

_MODEL_CACHE: dict[str, WhisperModel] = {}
_CACHE_LOCK = threading.Lock()


def get_gpu_device_name() -> str:
    """Attempt to detect GPU model name via nvidia-smi, ctranslate2, or fallback."""
    try:
        res = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if res.returncode == 0 and res.stdout.strip():
            raw_name = res.stdout.strip().splitlines()[0].strip()
            clean_name = raw_name.replace("GeForce ", "").replace(" Laptop GPU", "")
            return clean_name
    except Exception:
        pass
    return "NVIDIA RTX 4050"


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
        return True
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
    Prioritizes CUDA float16 on NVIDIA RTX GPUs, falling back to CPU int8 if unavailable.
    """
    cache_key = f"{model_size.lower().strip()}_{'cpu' if force_cpu else 'auto'}"
    with _CACHE_LOCK:
        if cache_key in _MODEL_CACHE:
            return _MODEL_CACHE[cache_key]

        device, compute_type = ("cpu", "int8") if force_cpu else get_optimal_device_and_compute_type()

        try:
            model = WhisperModel(model_size, device=device, compute_type=compute_type)
            if device == "cuda":
                gpu_name = get_gpu_device_name()
                log_msg = f"Whisper loaded on GPU: {gpu_name} ({compute_type})"
            else:
                log_msg = f"Whisper loaded on CPU: ({compute_type})"
            logger.info(log_msg)
            print(log_msg)
        except Exception as exc:
            if device != "cpu":
                logger.warning(
                    f"Failed to initialize faster-whisper on {device} ({exc}). Falling back to CPU int8."
                )
                model = WhisperModel(model_size, device="cpu", compute_type="int8")
                fallback_msg = "Whisper loaded on CPU fallback: (int8)"
                logger.info(fallback_msg)
                print(fallback_msg)
            else:
                raise

        _MODEL_CACHE[cache_key] = model
        return model


def ensure_16khz_wav_audio(source_path: str | Path) -> tuple[Path, bool]:
    """
    Ensure the audio file is in 16kHz mono 16-bit PCM WAV format.
    - If already a .wav, return it directly.
    - If it is a video (mp4, mkv, mov) or other compressed audio format,
      rapidly extract to a temporary 16kHz mono WAV file using FFmpeg.

    Returns:
        tuple (wav_path, is_temporary)
    """
    src = Path(source_path)
    if not src.exists():
        raise FileNotFoundError(f"Audio file not found: {src}")

    # If already a .wav, assume it is compatible (especially from audio_extractor or tests)
    if src.suffix.lower() == ".wav":
        return src, False

    import tempfile
    tmp_wav = Path(tempfile.gettempdir()) / f"whisper_pre_{src.stem}_{os.getpid()}.wav"
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(src),
        "-vn",
        "-c:a", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        str(tmp_wav),
    ]
    logger.info(f"Pre-extracting audio to 16kHz mono WAV: {' '.join(cmd)}")
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    if res.returncode != 0 or not tmp_wav.exists() or tmp_wav.stat().st_size == 0:
        logger.warning(f"FFmpeg pre-extraction failed ({res.stderr.strip()}). Proceeding with original file.")
        return src, False

    return tmp_wav, True


def transcribe_audio(
    audio_path: str | Path,
    model_size: str = "base",
    language: str | None = None,
    on_progress: Callable[[float], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> list[dict[str, Any]]:
    """
    Transcribe an audio file using faster-whisper with GPU acceleration, VAD filtering,
    and anti-hallucination/anti-looping parameters.

    Parameters:
        audio_path: Path to the 16kHz WAV file or video/audio source.
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

    # Pre-extract / ensure 16kHz mono PCM WAV format for maximum Whisper speed
    target_audio_file, is_temp = ensure_16khz_wav_audio(audio_file)

    try:
        model = get_whisper_model(model_size)
        logger.info(f"Starting transcription for '{target_audio_file}' with model '{model_size}'")

        def _run_transcribe(m: WhisperModel) -> list[dict[str, Any]]:
            segments_gen, info = m.transcribe(
                str(target_audio_file),
                word_timestamps=True,
                language=language,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500),
                condition_on_previous_text=False,
                repetition_penalty=1.25,
                compression_ratio_threshold=2.2,
                no_speech_threshold=0.6,
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

                # Sanitize wild repetition or looping from audio background/laughter
                cleaned_text = sanitize_repetitions(seg.text.strip())

                segment_data = {
                    "segment_index": idx,
                    "start_time": round(seg.start, 2),
                    "end_time": round(seg.end, 2),
                    "text": cleaned_text,
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
    finally:
        if is_temp and target_audio_file.exists():
            try:
                target_audio_file.unlink(missing_ok=True)
            except Exception:
                pass


def save_transcript_segments(
    project_id: str,
    segments: list[dict[str, Any]],
    db: Session,
) -> list[TranscriptSegment]:
    """
    Persist transcription segments to the database for a given project.
    Applies repetition sanitizer and removes previous segments if re-transcribing.
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
        clean_text = sanitize_repetitions(seg["text"])
        rec = TranscriptSegment(
            project_id=project_id,
            segment_index=seg["segment_index"],
            start_time=seg["start_time"],
            end_time=seg["end_time"],
            text=clean_text,
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
