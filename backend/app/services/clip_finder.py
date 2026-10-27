"""
services/clip_finder.py — AI Clip Finder Engine powered by Google Gemini API.

Analyzes timestamped transcripts to discover high-retention, viral short-form
clip candidates (20-60s) for TikTok, YouTube Shorts, and Instagram Reels.
Includes automatic heuristic fallback for offline or quota-limited scenarios.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.clip import ClipCandidate
from app.models.transcript import TranscriptSegment

logger = logging.getLogger("clipperforge.clip_finder")


# ── Editorial Prompt ──────────────────────────────────────────────────────────

CLIP_CURATION_SYSTEM_INSTRUCTION = """Anda adalah kurator video pendek dan editor media sosial profesional papan atas (spesialis TikTok, YouTube Shorts, Instagram Reels).
Tugas Anda adalah menelaah transkrip video berikut dan merekomendasikan 3 hingga 6 klip paling menarik, berpotensi viral tinggi, dan bernilai tonton tinggi.

Kriteria Pemilihan Klip:
1. Durasi setiap klip wajib di antara 20 hingga 60 detik (start_time dan end_time harus merujuk pada timestamp transkrip).
2. Punya HOOK kuat di awal klip (pertanyaan tajam, fakta mengejutkan, atau pernyataan menarik).
3. Memiliki keutuhan cerita/pemikiran (tidak terpotong di tengah kalimat atau frasa menggantung).
4. Berikan virality_score (1 - 100) berdasarkan potensi retensi audiens dan shareability.

Format output WAJIB array JSON valid persis seperti skema berikut:
[
  {
    "title": "Judul klip yang memikat (maks 60 karakter)",
    "hook": "Kalimat pembuka / pertanyaan penarik perhatian",
    "rationale": "Analisis editorial singkat mengapa bagian ini berpotensi viral",
    "start_time": 12.5,
    "end_time": 45.0,
    "category": "insight",
    "virality_score": 88
  }
]
Kategori yang valid: insight, story, humor, tutorial, controversy, highlight.
"""


def _clean_json_response(text: str) -> str:
    """Strip markdown code fence blocks if returned by LLM."""
    cleaned = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    if match:
        return match.group(1).strip()
    return cleaned


def _get_seg_attr(seg: Any, attr: str, default: Any = None) -> Any:
    """Helper to access attribute from either a Pydantic/SQLAlchemy model or a dict."""
    if isinstance(seg, dict):
        return seg.get(attr, default)
    return getattr(seg, attr, default)


def _fallback_curate_clips(
    segments: list[Any],
    max_duration: float = 600.0,
) -> list[dict[str, Any]]:
    """
    Heuristic algorithm that groups speech segments into 25-50 second clips
    when Gemini API is unreachable or quota is exceeded.
    Supports either TranscriptSegment OR dict objects.
    """
    logger.info("Using heuristic fallback clip curation algorithm.")
    if not segments:
        return []

    candidates: list[dict[str, Any]] = []
    current_start = float(_get_seg_attr(segments[0], "start_time", 0.0))
    current_text: list[str] = []
    target_duration = 35.0  # ideal short duration

    categories = ["insight", "story", "highlight", "tutorial"]
    cat_idx = 0

    for seg in segments:
        seg_text = str(_get_seg_attr(seg, "text", ""))
        seg_end = float(_get_seg_attr(seg, "end_time", current_start + 1.0))
        current_text.append(seg_text)
        duration = seg_end - current_start

        if duration >= target_duration or seg == segments[-1]:
            if duration >= 15.0:
                first_sentence = current_text[0] if current_text else "Momen Pembahasan Video"
                hook = first_sentence[:80] + ("..." if len(first_sentence) > 80 else "")
                title = f"Sorotan: {hook[:45]}"

                candidates.append({
                    "title": title,
                    "hook": hook,
                    "rationale": f"[Kurasi Otomatis] Segmen padat informasi berdurasi {round(duration, 1)} detik dengan alur percakapan utuh.",
                    "start_time": round(current_start, 2),
                    "end_time": round(min(seg_end, max_duration), 2),
                    "category": categories[cat_idx % len(categories)],
                    "virality_score": 75 + (cat_idx % 15),
                })
                cat_idx += 1

            if len(candidates) >= 5:
                break

            current_start = seg_end
            current_text = []

    return candidates


def curate_clips_with_gemini(
    transcript_text: str | list[Any],
    segments: list[Any] | None = None,
    video_duration: float = 600.0,
    project_title: str | None = None,
) -> list[dict[str, Any]]:
    """
    Send transcript to Google Gemini API and parse structured clip candidates.
    Falls back to heuristic curation on failure.
    Supports flexible arguments for both prompt text and segment lists.
    """
    # Normalize segments and transcript_text if segments passed as first arg
    if isinstance(transcript_text, list) and segments is None:
        segments = transcript_text
        lines = []
        for s in segments:
            st = _get_seg_attr(s, "start_time", 0.0)
            et = _get_seg_attr(s, "end_time", 0.0)
            txt = _get_seg_attr(s, "text", "")
            lines.append(f"[{st:.1f} - {et:.1f}] {txt}")
        prompt_transcript = "\n".join(lines)
    else:
        prompt_transcript = str(transcript_text)
        if segments is None:
            segments = []

    if not settings.GEMINI_API_KEY:
        logger.warning("GEMINI_API_KEY is not configured. Falling back to heuristic curation.")
        return _fallback_curate_clips(segments, video_duration)

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        config = types.GenerateContentConfig(
            system_instruction=CLIP_CURATION_SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            temperature=0.4,
        )

        title_info = f"Judul Video: {project_title}\n\n" if project_title else ""
        prompt = f"{title_info}Analisis transkrip berikut dan pilih 3 sampai 6 klip terbaik:\n\n{prompt_transcript}"
        logger.info("Calling Gemini API for viral clip curation...")

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=config,
        )

        response_text = response.text or ""
        cleaned = _clean_json_response(response_text)
        data = json.loads(cleaned)

        if isinstance(data, dict) and "clips" in data:
            data = data["clips"]

        if not isinstance(data, list) or not data:
            logger.warning("Gemini returned invalid or empty JSON list. Using fallback.")
            return _fallback_curate_clips(segments, video_duration)

        valid_clips: list[dict[str, Any]] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            start_t = float(item.get("start_time", 0.0))
            end_t = float(item.get("end_time", 0.0))

            # Sanity adjustments
            if end_t <= start_t:
                continue
            start_t = max(0.0, start_t)
            end_t = min(video_duration, end_t)
            if end_t - start_t < 10.0:
                continue

            valid_clips.append({
                "title": str(item.get("title", "Klip Viral Pilihan"))[:255],
                "hook": str(item.get("hook", ""))[:512],
                "rationale": str(item.get("rationale", "")),
                "start_time": round(start_t, 2),
                "end_time": round(end_t, 2),
                "category": str(item.get("category", "insight")).lower()[:64],
                "virality_score": int(max(1, min(100, item.get("virality_score", 70)))),
            })

        if valid_clips:
            # Sort by virality score descending
            valid_clips.sort(key=lambda x: x["virality_score"], reverse=True)
            logger.info(f"Successfully curated {len(valid_clips)} clips using Gemini API.")
            return valid_clips

        logger.warning("No valid clips after parsing Gemini output. Using fallback.")
        return _fallback_curate_clips(segments, video_duration)

    except Exception as exc:
        logger.warning(f"Gemini API clip curation encountered an error: {exc}. Using fallback.")
        return _fallback_curate_clips(segments, video_duration)


def save_clip_candidates(
    project_id: str,
    clips: list[dict[str, Any]],
    db: Session,
) -> list[ClipCandidate]:
    """
    Save generated clip candidates to SQLite database.
    Replaces existing suggested clips if any.
    """
    # Delete previous suggested clips for this project
    existing = db.execute(
        select(ClipCandidate).where(
            ClipCandidate.project_id == project_id,
            ClipCandidate.status == "suggested",
        )
    ).scalars().all()
    for item in existing:
        db.delete(item)
    db.commit()

    records: list[ClipCandidate] = []
    for c in clips:
        candidate = ClipCandidate(
            project_id=project_id,
            title=c["title"],
            hook=c["hook"],
            rationale=c["rationale"],
            start_time=c["start_time"],
            end_time=c["end_time"],
            virality_score=c["virality_score"],
            category=c["category"],
            status="suggested",
        )
        db.add(candidate)
        records.append(candidate)

    db.commit()
    for r in records:
        db.refresh(r)

    return records
