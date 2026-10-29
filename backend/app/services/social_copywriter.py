"""
services/social_copywriter.py — AI Social Media Copywriter Service.

Generates viral, platform-tailored metadata for:
- 'tiktok': 1-line curiosity hook, short punchy caption (<= 150 chars), 4 trending hashtags, and comment-bait question.
- 'shorts': Bold SEO title (< 60 chars), keyword-rich description, 3 primary hashtags (#Shorts + 2 topics).
- 'reels': Aesthetic micro-blogging caption, 5 targeted hashtags, and engagement Call-to-Action (CTA).

Uses Google Gemini (gemini-3.8-flash) when API key is available, with an intelligent
100% offline local algorithmic fallback engine.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any
from sqlalchemy.orm import Session

from app.core.config import settings

logger = logging.getLogger(__name__)


def _clean_text(text: str) -> str:
    """Removes unwanted wrapper quotes or extra whitespace."""
    if not text:
        return ""
    cleaned = text.strip().replace('"', "").replace("'", "")
    return re.sub(r"\s+", " ", cleaned).strip()


def _extract_topic_keyword(title: str, hook: str, custom_topic: str | None = None) -> str:
    """Extracts a clean single-word or camel-case topic keyword for hashtags."""
    if custom_topic and custom_topic.strip():
        cleaned = re.sub(r"[^a-zA-Z0-9]", "", custom_topic.strip())
        if cleaned:
            return cleaned.lower()

    text = f"{title} {hook}"
    # Remove emojis and punctuation
    words = re.findall(r"[a-zA-Z]{4,}", text)
    stop_words = {
        "yang", "untuk", "dengan", "pada", "dari", "dalam", "bisa", "akan",
        "adalah", "karena", "saat", "tidak", "jadi", "sudah", "kamu", "kita",
        "ini", "itu", "momen", "video", "detik", "banget", "ternyata", "rahasia"
    }
    meaningful = [w.lower() for w in words if w.lower() not in stop_words]
    if meaningful:
        return meaningful[0]
    return "podcast"


def format_full_text(platform: str, title: str, hook: str, caption: str, hashtags: list[str], cta: str) -> str:
    """
    Formats the complete copy for 1-click clipboard copying.
    """
    tags_line = " ".join([h if h.startswith("#") else f"#{h}" for h in hashtags if h.strip()])
    
    if platform.lower() == "tiktok":
        parts = [
            hook.strip(),
            caption.strip(),
            cta.strip(),
            tags_line,
        ]
        return "\n\n".join([p for p in parts if p])

    elif platform.lower() == "shorts":
        parts = [
            f"{title.strip()} #Shorts" if not title.endswith("#Shorts") else title.strip(),
            caption.strip(),
            cta.strip(),
            tags_line,
        ]
        return "\n\n".join([p for p in parts if p])

    else:  # reels
        parts = [
            hook.strip(),
            caption.strip(),
            cta.strip(),
            tags_line,
        ]
        return "\n\n".join([p for p in parts if p])


def _generate_algorithmic_social_copy(
    title: str,
    hook: str,
    rationale: str = "",
    transcript_text: str = "",
    custom_topic: str | None = None,
) -> dict[str, dict[str, Any]]:
    """
    Algorithmic fallback for viral copy generation.
    Generates rich, platform-optimized copy without external API requirements.
    """
    clean_title = _clean_text(title) or "Momen Menarik Hari Ini"
    clean_hook = _clean_text(hook) or f"Gak nyangka bagian ini beneran terjadi... 😱"
    topic = _extract_topic_keyword(clean_title, clean_hook, custom_topic)

    # 1. TikTok Copy (Hook, short <=150 chars caption, 4 hashtags, comment bait)
    tt_hook = f"Tunggu sampai detik akhir... {clean_hook}"
    tt_caption = f"Momen {clean_title[:75]} ini bikin mikir dua kali! Jangan skip bagian akhirnya."
    if len(tt_caption) > 150:
        tt_caption = tt_caption[:147] + "..."
    tt_cta = "Menurut kalian ini beneran wajar gak sih? Tulis opini kalian di komentar! 👇"
    tt_tags = ["#fyp", "#viral", "#foryoupage", f"#{topic}"]
    tt_full = format_full_text("tiktok", clean_title, tt_hook, tt_caption, tt_tags, tt_cta)

    # 2. YouTube Shorts Copy (Bold SEO title < 60 chars, rich description, #Shorts + 2 tags)
    sh_title = clean_title
    if len(sh_title) > 50:
        sh_title = sh_title[:50].rsplit(" ", 1)[0]
    sh_hook = clean_hook
    sh_caption = (
        f"Membahas momen mengejutkan seputar {clean_title}. Simak video selengkapnya dan temukan "
        f"sudut pandang yang jarang dibahas orang lain."
    )
    sh_cta = "🔔 Subscribe channel ini untuk update video shorts seru dan informatif lainnya setiap hari!"
    sh_tags = ["#Shorts", "#YouTubeShorts", f"#{topic}"]
    sh_full = format_full_text("shorts", sh_title, sh_hook, sh_caption, sh_tags, sh_cta)

    # 3. Instagram Reels Copy (Aesthetic micro-blogging, 5 tags, interaction CTA)
    ig_hook = f"✨ {clean_hook}"
    ig_caption = (
        f"Pernah gak sih kalian mikirin momen kayak gini?\n\n"
        f"Saat {clean_title}, ada pesan penting yang sering banget kita lewatkan. "
        f"Bukan cuma soal serunya, tapi banyak pembelajaran menarik di baliknya.\n\n"
        f"Tonton sampai akhir dan simpan reels ini untuk referensi kamu nanti 📌"
    )
    ig_cta = "👉 Follow @channel untuk insight & klip podcast terbaik setiap hari! Share ke temen kamu."
    ig_tags = ["#reelsindonesia", "#explorepage", "#viralreels", "#trending", f"#{topic}"]
    ig_full = format_full_text("reels", clean_title, ig_hook, ig_caption, ig_tags, ig_cta)

    return {
        "tiktok": {
            "platform": "tiktok",
            "title": clean_title,
            "hook": tt_hook,
            "caption": tt_caption,
            "hashtags": tt_tags,
            "cta": tt_cta,
            "full_formatted_text": tt_full,
        },
        "shorts": {
            "platform": "shorts",
            "title": sh_title,
            "hook": sh_hook,
            "caption": sh_caption,
            "hashtags": sh_tags,
            "cta": sh_cta,
            "full_formatted_text": sh_full,
        },
        "reels": {
            "platform": "reels",
            "title": clean_title,
            "hook": ig_hook,
            "caption": ig_caption,
            "hashtags": ig_tags,
            "cta": ig_cta,
            "full_formatted_text": ig_full,
        },
    }


def generate_social_copy(
    title: str,
    hook: str,
    rationale: str = "",
    transcript_text: str = "",
    platform: str = "all",
    custom_topic: str | None = None,
    db: Session | None = None,
) -> dict[str, dict[str, Any]]:
    """
    Main entrypoint for generating platform-specific social copy.
    Tries Google Gemini AI if configured, otherwise falls back smoothly to algorithmic generation.
    """
    copies = None

    if settings.GEMINI_API_KEY:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            config = types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.75,
            )

            prompt = (
                f"Kamu adalah AI Social Media Copywriter kelas dunia untuk kreator video pendek.\n"
                f"Buatkan copy postingan viral untuk video dengan detail berikut:\n"
                f"- Judul Klip: '{title}'\n"
                f"- Hook Utama: '{hook}'\n"
                f"- Rationale/Konteks: '{rationale}'\n"
                f"- Cuplikan Transkrip: '{transcript_text[:1200]}'\n\n"
                f"Buatkan output JSON murni dengan 3 key: 'tiktok', 'shorts', dan 'reels'.\n"
                f"Setiap objek platform WAJIB memiliki field:\n"
                f"1. 'tiktok':\n"
                f"   - 'hook': 1 baris memancing penasaran (curiosity gap)\n"
                f"   - 'caption': caption singkat padat (maksimal 150 karakter)\n"
                f"   - 'hashtags': array 4 string tagar relevan tren (contoh: [\"#fyp\", \"#viral\", ...])\n"
                f"   - 'cta': 1 baris pertanyaan pemicu komentar/debat netizen\n"
                f"2. 'shorts':\n"
                f"   - 'title': judul SEO tebal maksimal 60 karakter tanpa hashtag\n"
                f"   - 'hook': hook pembuka\n"
                f"   - 'caption': deskripsi padat kata kunci pencarian YouTube (2-3 kalimat)\n"
                f"   - 'hashtags': array 3 string tagar (#Shorts + 2 topik terkait)\n"
                f"   - 'cta': call to action subscribe dan like\n"
                f"3. 'reels':\n"
                f"   - 'title': judul estetis\n"
                f"   - 'hook': pembuka menarik dengan emoji\n"
                f"   - 'caption': caption bergaya micro-blogging estetik rapi (3-4 paragraf pendek)\n"
                f"   - 'hashtags': array 5 string tagar bertarget\n"
                f"   - 'cta': ajakan share, save reels, atau follow akun\n\n"
                f"Format output JSON:"
                f"{{\n"
                f"  \"tiktok\": {{\"title\": \"...\", \"hook\": \"...\", \"caption\": \"...\", \"hashtags\": [...], \"cta\": \"...\"}},\n"
                f"  \"shorts\": {{\"title\": \"...\", \"hook\": \"...\", \"caption\": \"...\", \"hashtags\": [...], \"cta\": \"...\"}},\n"
                f"  \"reels\": {{\"title\": \"...\", \"hook\": \"...\", \"caption\": \"...\", \"hashtags\": [...], \"cta\": \"...\"}}\n"
                f"}}"
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
                    feature_name="social_copy",
                    model_name="gemini-3.8-flash",
                    response=resp,
                )
            except Exception as log_err:
                logger.debug(f"Failed to log social_copy token usage: {log_err}")

            raw = (resp.text or "").strip()
            # Clean markdown code block if present
            m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw)
            cleaned = m.group(1).strip() if m else raw
            parsed = json.loads(cleaned)

            if isinstance(parsed, dict) and "tiktok" in parsed and "shorts" in parsed and "reels" in parsed:
                result_copies = {}
                for plat in ["tiktok", "shorts", "reels"]:
                    p_data = parsed.get(plat, {})
                    p_title = _clean_text(p_data.get("title", title))
                    p_hook = _clean_text(p_data.get("hook", hook))
                    p_caption = p_data.get("caption", "").strip()
                    p_hashtags = [
                        h if str(h).startswith("#") else f"#{h}"
                        for h in p_data.get("hashtags", [])
                        if str(h).strip()
                    ]
                    p_cta = p_data.get("cta", "").strip()
                    p_full = format_full_text(plat, p_title, p_hook, p_caption, p_hashtags, p_cta)

                    result_copies[plat] = {
                        "platform": plat,
                        "title": p_title,
                        "hook": p_hook,
                        "caption": p_caption,
                        "hashtags": p_hashtags,
                        "cta": p_cta,
                        "full_formatted_text": p_full,
                    }
                copies = result_copies
        except Exception as exc:
            logger.warning(
                f"Gemini social copywriter failed ({exc}). Using offline algorithmic fallback."
            )

    if not copies:
        copies = _generate_algorithmic_social_copy(
            title=title,
            hook=hook,
            rationale=rationale,
            transcript_text=transcript_text,
            custom_topic=custom_topic,
        )

    # Filter if user requested only one platform
    target_platform = platform.lower()
    if target_platform in ["tiktok", "shorts", "reels"]:
        return {target_platform: copies[target_platform]}

    return copies
