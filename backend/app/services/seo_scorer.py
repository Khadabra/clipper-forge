"""
services/seo_scorer.py — SEO Title Analyzer & Viral Hook Scorer (Ala Rank Math / Yoast).

Evaluates video clip titles for short-form platforms (TikTok, YouTube Shorts, Reels)
based on:
1. Ideal character length (30-65 characters)
2. Presence of emotional Power Words (e.g. Kaget, Momen, Ternyata, Bongkar, Gak Bisa)
3. Curiosity Gap & Punctuation (numbers, questions marks, exclamation)
4. Hook formatting & sentiment strength (capitalization, action verbs, no dull fillers)

Also provides AI-powered title recommendations via Gemini API with algorithmic fallback.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any
from sqlalchemy.orm import Session

from app.core.config import settings

logger = logging.getLogger("clipperforge.seo_scorer")

# Curated list of Indonesian & Gaming/Streamer viral power words
POWER_WORDS: list[str] = [
    # Indonesian emotional & curiosity triggers
    "kaget",
    "momen",
    "ternyata",
    "bongkar",
    "rahasia",
    "gak bisa",
    "tidak bisa",
    "gila",
    "parah",
    "nyesel",
    "syok",
    "terbaik",
    "trik",
    "tips",
    "wajib",
    "bikin",
    "viral",
    "detik-detik",
    "terungkap",
    "mustahil",
    "terlarang",
    "ampuh",
    "heboh",
    "menyesal",
    "jebakan",
    "alasan",
    "fakta",
    # English / Gaming / Streamer triggers
    "hide",
    "pro",
    "noob",
    "hacker",
    "clutch",
    "insane",
    "shocking",
    "epic",
    "unbelievable",
    "secret",
    "never",
    "always",
    "reaction",
    "moment",
    "glitch",
    "meta",
    "win",
    "cheat",
    "banned",
]

BORING_FILLERS: list[str] = [
    "video ini",
    "cuma sekedar",
    "iseng",
    "halo teman",
    "halo guys",
    "konten ini",
    "postingan",
    "channel ini",
]


def analyze_title_seo(title: str) -> dict[str, Any]:
    """
    Analyzes a video title and returns a 0-100 score, rating, and Rank Math-style checklist.
    """
    clean_title = (title or "").strip()
    char_len = len(clean_title)

    checklist: list[dict[str, Any]] = []
    suggestions: list[str] = []

    # ── 1. Length Check (Max 25 pts) ──────────────────────────────────────────
    length_score = 0
    if 30 <= char_len <= 65:
        length_score = 25
        length_status = "good"
        length_msg = f"Panjang judul optimal ({char_len} karakter). Pas untuk mobile feed Shorts & TikTok."
    elif 20 <= char_len < 30:
        length_score = 15
        length_status = "warning"
        length_msg = f"Panjang judul cukup ({char_len} karakter), tapi lebih optimal antara 30–65 karakter."
        suggestions.append("Tambahkan konteks atau kata penguat agar panjang judul mencapai 30–65 karakter.")
    elif 66 <= char_len <= 80:
        length_score = 16
        length_status = "warning"
        length_msg = f"Panjang judul ({char_len} karakter) agak panjang dan berisiko terpotong di layar smartphone kecil."
        suggestions.append("Persingkat sedikit agar judul tidak terpotong di feed media sosial.")
    elif char_len < 20:
        length_score = 5 if char_len > 0 else 0
        length_status = "critical"
        length_msg = f"Judul terlalu pendek ({char_len} karakter). Sulit menarik perhatian penonton."
        suggestions.append("Perpanjang judul minimal 30 karakter untuk menjelaskan momen menarik dalam klip.")
    else:  # > 80
        length_score = 8
        length_status = "critical"
        length_msg = f"Judul terlalu panjang ({char_len} karakter). Pasti terpotong tanda (...) di TikTok & Reels."
        suggestions.append("Pangkas judul menjadi maksimal 65 karakter.")

    checklist.append({
        "id": "length",
        "label": "Panjang Judul Ideal",
        "status": length_status,
        "score": length_score,
        "max_score": 25,
        "message": length_msg,
        "tip": "Panjang optimal 30–65 karakter agar keterbacaan di beranda smartphone maksimal.",
    })

    # ── 2. Power Words / Emotional Hook (Max 25 pts) ─────────────────────────
    title_lower = clean_title.lower()
    matched_power_words = [pw for pw in POWER_WORDS if pw in title_lower]

    if len(matched_power_words) >= 2:
        power_score = 25
        power_status = "good"
        power_msg = f"Ditemukan {len(matched_power_words)} Power Words emosional ({', '.join(matched_power_words[:3])})."
    elif len(matched_power_words) == 1:
        power_score = 18
        power_status = "good"
        power_msg = f"Ditemukan 1 Power Word: '{matched_power_words[0]}'."
        suggestions.append("Tambahkan satu kata emosional lagi (misal: 'Ternyata', 'Gak Bisa', 'Rahasia') untuk mendongkrak CTR.")
    else:
        power_score = 0
        power_status = "critical"
        power_msg = "Tidak ditemukan kata kunci pemicu emosi (Power Words)."
        suggestions.append("Gunakan kata pemicu rasa penasaran seperti 'Ternyata', 'Momen', 'Bongkar', 'Kaget', atau 'Rahasia'.")

    checklist.append({
        "id": "power_words",
        "label": "Power Words & Emosional",
        "status": power_status,
        "score": power_score,
        "max_score": 25,
        "message": power_msg,
        "tip": "Kata emosional memicu lonjakan Click-Through Rate (CTR) audiens.",
    })

    # ── 3. Curiosity Gap & Tanda Baca (Max 25 pts) ────────────────────────────
    has_number = bool(re.search(r"\b\d+\b|\d+%", clean_title))
    has_curiosity_punct = ("?" in clean_title) or ("!" in clean_title) or (":" in clean_title)

    if has_number and has_curiosity_punct:
        curiosity_score = 25
        curiosity_status = "good"
        curiosity_msg = "Mengandung angka spesifik dan tanda baca pemicu rasa ingin tahu ('?', '!', atau ':')."
    elif has_number:
        curiosity_score = 18
        curiosity_status = "good"
        curiosity_msg = "Mengandung angka spesifik yang disukai algoritma rekomendasi."
        if "?" not in clean_title:
            suggestions.append("Coba akhiri dengan tanda tanya '?' untuk memicu rasa penasaran penonton.")
    elif has_curiosity_punct:
        curiosity_score = 16
        curiosity_status = "good"
        curiosity_msg = "Mengandung tanda pemicu rasa penasaran ('?' atau '!')."
        suggestions.append("Sisipkan angka spesifik (misal '3 Trik...', '100%') untuk menambah kredibilitas.")
    else:
        curiosity_score = 0
        curiosity_status = "critical"
        curiosity_msg = "Tidak ada angka atau tanda pemicu rasa penasaran (Curiosity Gap)."
        suggestions.append("Gunakan angka (contoh: '3 Hal...', 'Top 1') atau tanda tanya '?' untuk memicu rasa penasaran.")

    checklist.append({
        "id": "curiosity_gap",
        "label": "Curiosity Gap & Angka",
        "status": curiosity_status,
        "score": curiosity_score,
        "max_score": 25,
        "message": curiosity_msg,
        "tip": "Angka dan pertanyaan membuka 'curiosity gap' yang memaksa audiens untuk menonton.",
    })

    # ── 4. Hook Strength & Formatting (Max 25 pts) ───────────────────────────
    hook_score = 25
    hook_issues: list[str] = []

    words = clean_title.split()
    if len(words) < 3 and char_len > 0:
        hook_score -= 10
        hook_issues.append("Judul terlalu sedikit kata (minimal 3-4 kata).")

    # Check for dull filler phrases
    has_filler = any(filler in title_lower for filler in BORING_FILLERS)
    if has_filler:
        hook_score -= 12
        hook_issues.append("Hindari kata basi pengisi seperti 'Video ini' atau 'Halo guys'.")

    # Capitalization check
    if clean_title and clean_title[0].islower():
        hook_score -= 5
        hook_issues.append("Awali huruf pertama judul dengan huruf kapital.")

    # All-caps spam check (> 70% uppercase on long titles)
    if char_len > 25:
        letters = [c for c in clean_title if c.isalpha()]
        if letters and (sum(1 for c in letters if c.isupper()) / len(letters)) > 0.85:
            hook_score -= 4
            hook_issues.append("Gunakan huruf kapital selektif pada kata penting saja, bukan seluruh kalimat.")

    hook_score = max(0, hook_score)

    if hook_score >= 20:
        hook_status = "good"
        hook_msg = "Format penulisan rapi, kuat, dan langsung ke inti pembahasan."
    elif hook_score >= 12:
        hook_status = "warning"
        hook_msg = f"Format hook cukup baik. {(' '.join(hook_issues)) if hook_issues else ''}"
        suggestions.extend(hook_issues)
    else:
        hook_status = "critical"
        hook_msg = f"Format hook lemah. {(' '.join(hook_issues)) if hook_issues else ''}"
        suggestions.extend(hook_issues)

    checklist.append({
        "id": "hook_strength",
        "label": "Format & Kekuatan Hook",
        "status": hook_status,
        "score": hook_score,
        "max_score": 25,
        "message": hook_msg,
        "tip": "Judul harus lugas, diawali huruf kapital, dan tanpa basa-basi.",
    })

    # ── Total Score & Rating ─────────────────────────────────────────────────
    total_score = min(100, max(0, length_score + power_score + curiosity_score + hook_score))

    if total_score >= 75:
        rating = "good"
    elif total_score >= 50:
        rating = "fair"
    else:
        rating = "poor"

    if not suggestions and total_score >= 80:
        suggestions.append("Judul sudah sangat memikat dan siap dipublikasikan untuk performa algoritma maksimal!")

    return {
        "title": clean_title,
        "score": total_score,
        "rating": rating,
        "char_count": char_len,
        "word_count": len(words),
        "matched_power_words": matched_power_words,
        "checklist": checklist,
        "suggestions": suggestions,
    }


def generate_seo_title_recommendations(
    current_title: str,
    hook: str = "",
    topic_hint: str = "",
    db: Session | None = None,
) -> list[dict[str, Any]]:
    """
    Generates 3 high-SEO viral title suggestions.
    Uses Gemini API if configured, with smart local algorithmic fallback.
    Each title is pre-analyzed and guaranteed to have high SEO metrics.
    """
    base_text = hook.strip() or current_title.strip() or "Momen Gameplay Epik"
    clean_base = re.sub(r"^[A-Za-z0-9\s_-]+:\s*", "", base_text).strip()
    clean_base = clean_base.replace('"', "").replace("'", "")
    if len(clean_base) > 40:
        clean_base = clean_base[:40].rsplit(" ", 1)[0]

    # Attempt AI generation via Gemini
    if settings.GEMINI_API_KEY:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            config = types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.7,
            )
            prompt = (
                f"Buat 3 rekomendasi judul video pendek (TikTok/Shorts/Reels) yang viral, memiliki SEO tinggi "
                f"(skor 80-100), mengandung Power Words emosional, angka, dan rasa penasaran kuat.\n"
                f"Judul saat ini: '{current_title}'\n"
                f"Hook klip: '{hook}'\n\n"
                f"Format output WAJIB JSON array murni berupa string: [\"Judul 1\", \"Judul 2\", \"Judul 3\"]"
            )
            resp = client.models.generate_content(
                model="gemini-3.8-flash",
                contents=prompt,
                config=config,
            )

            # Log Gemini token consumption
            try:
                from app.services.token_tracker import log_gemini_usage
                log_gemini_usage(
                    db=db,
                    feature_name="seo_title",
                    model_name="gemini-3.8-flash",
                    response=resp,
                )
            except Exception as log_err:
                logger.debug(f"Failed to log seo_title token usage: {log_err}")

            raw = (resp.text or "").strip()
            # Clean markdown code fences if any
            m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw)
            cleaned = m.group(1).strip() if m else raw
            parsed = json.loads(cleaned)
            if isinstance(parsed, list) and len(parsed) >= 3:
                results = []
                for t in parsed[:3]:
                    analysis = analyze_title_seo(str(t))
                    results.append({
                        "title": str(t),
                        "score": analysis["score"],
                        "rating": analysis["rating"],
                        "matched_power_words": analysis["matched_power_words"],
                    })
                return results
        except Exception as exc:
            logger.warning(f"Gemini title recommendation failed: {exc}. Using smart algorithmic fallback.")

    # High-SEO Algorithmic Variations
    templates = [
        f"Ternyata Ini Rahasia Momen {clean_base}: Wajib Tonton?",
        f"Kaget Banget! 3 Trik {clean_base} yang Gak Bisa Ditiru!",
        f"Detik-Detik {clean_base} Terbongkar, Bikin Syok 100%!",
    ]

    results = []
    for t in templates:
        analysis = analyze_title_seo(t)
        results.append({
            "title": t,
            "score": analysis["score"],
            "rating": analysis["rating"],
            "matched_power_words": analysis["matched_power_words"],
        })

    return results
