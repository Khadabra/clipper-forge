"""
services/subtitle_burner.py — Dynamic subtitle generation and styling (ASS format).

Transforms timestamped transcript segments into styled subtitle files (.ass)
specifically clipped and offset for short-form video exports (9:16, 1:1, 16:9).
Supports custom transcript overrides per-clip and rich visual presets:
- condensed_clean (crisp minimalist white)
- hormozi (high-contrast viral yellow, Impact/Arial Black)
- boxed_vox (Vox/documentary boxed background)
- cyber_neon (cyan & magenta outline gaming/podcast)
- word_highlight (viral FYP micro-chunking 2-3 words with active bright yellow illumination & visual enlargement)
- none (no subtitles)
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
import re
from typing import Any

logger = logging.getLogger("clipperforge.subtitle_burner")

# Context keywords dictionary (Indonesian & English)
# 'uang', 'duit', 'kaya', 'bisnis', 'cuan' -> 💸
# 'kaget', 'syok', 'gila', 'mati', 'ngeri' -> 😱
# 'viral', 'api', 'heboh', 'trending', 'mantap' -> 🔥
# 'lucu', 'ketawa', 'ngakak', 'wkwk', 'haha' -> 😂
# 'ide', 'solusi', 'trik', 'cara', 'tips' -> 💡
EMOJI_KEYWORD_MAP: dict[str, str] = {
    # Uang / Cuan / Money
    "uang": "💸",
    "duit": "💸",
    "kaya": "💸",
    "bisnis": "💸",
    "cuan": "💸",
    "money": "💸",
    "rich": "💸",
    "wealth": "💸",
    "cash": "💸",
    "profit": "💸",
    "business": "💸",
    # Kaget / Shock
    "kaget": "😱",
    "syok": "😱",
    "gila": "😱",
    "mati": "😱",
    "ngeri": "😱",
    "shock": "😱",
    "shocking": "😱",
    "crazy": "😱",
    "insane": "😱",
    "dead": "😱",
    "scary": "😱",
    "scared": "😱",
    "omg": "😱",
    # Viral / Api / Fire
    "viral": "🔥",
    "api": "🔥",
    "heboh": "🔥",
    "trending": "🔥",
    "mantap": "🔥",
    "fire": "🔥",
    "lit": "🔥",
    "hype": "🔥",
    "epic": "🔥",
    "awesome": "🔥",
    # Lucu / Laugh
    "lucu": "😂",
    "ketawa": "😂",
    "ngakak": "😂",
    "wkwk": "😂",
    "haha": "😂",
    "funny": "😂",
    "laugh": "😂",
    "lol": "😂",
    "hilarious": "😂",
    "joke": "😂",
    # Ide / Solusi / Tips
    "ide": "💡",
    "solusi": "💡",
    "trik": "💡",
    "cara": "💡",
    "tips": "💡",
    "idea": "💡",
    "solution": "💡",
    "trick": "💡",
    "hack": "💡",
    "secret": "💡",
}


def get_word_emoji(word: str) -> str | None:
    """
    Check if a word matches any context keyword and return its corresponding emoji.
    Punctuation is stripped and comparison is case-insensitive.
    """
    clean = re.sub(r"[^\w]", "", word.lower())
    return EMOJI_KEYWORD_MAP.get(clean)


def inject_emojis_into_text(text: str) -> str:
    """
    Inject context emoji next to matching keywords in standard subtitle text.
    """
    words = text.split()
    res = []
    for w in words:
        emoji = get_word_emoji(w)
        if emoji and emoji not in w:
            res.append(f"{w} {emoji}")
        else:
            res.append(w)
    return " ".join(res)


def format_ass_time(seconds: float) -> str:
    """Format seconds into ASS dialogue timestamp: H:MM:SS.cs"""
    clamped = max(0.0, seconds)
    hours = int(clamped // 3600)
    minutes = int((clamped % 3600) // 60)
    secs = int(clamped % 60)
    cs = int(round((clamped % 1) * 100))
    if cs >= 100:
        cs = 99
    return f"{hours}:{minutes:02d}:{secs:02d}.{cs:02d}"


def escape_ffmpeg_filter_path(path: Path | str) -> str:
    """
    Escape file path for use in FFmpeg filter graph (subtitles/ass filter).
    On Windows, colons in drive letters (C:) and backslashes must be handled.
    """
    posix_path = Path(path).resolve().as_posix()
    escaped = posix_path.replace(":", "\\:").replace("'", "\\'")
    return escaped


def _get_seg_value(seg: Any, key: str, default: Any = None) -> Any:
    if isinstance(seg, dict):
        return seg.get(key, default)
    return getattr(seg, key, default)


def remap_timestamp_for_silence(
    rel_time: float,
    audible_segments: list[tuple[float, float]],
) -> float:
    """
    Map an original relative timestamp (relative to clip_start) to the new timeline
    after silence removal jump-cuts.
    """
    if not audible_segments:
        return max(0.0, rel_time)

    if rel_time <= audible_segments[0][0]:
        return 0.0

    accumulated = 0.0
    for seg_s, seg_e in audible_segments:
        seg_dur = max(0.0, seg_e - seg_s)
        if rel_time <= seg_s:
            return accumulated
        if seg_s <= rel_time <= seg_e:
            return accumulated + (rel_time - seg_s)
        accumulated += seg_dur

    return accumulated


def remap_segments_for_silence(
    segments: list[Any],
    clip_start: float,
    audible_segments: list[tuple[float, float]],
) -> list[dict[str, Any]]:
    """
    Remap subtitle segments and their word-level timestamps according to the
    audible_segments kept after silence removal.
    Returns a new list of dicts with remapped start_time and end_time (relative to 0.0).
    """
    if not audible_segments:
        return [
            s if isinstance(s, dict) else s.model_dump() if hasattr(s, "model_dump") else dict(s)
            for s in segments
        ]

    remapped: list[dict[str, Any]] = []
    for seg in segments:
        orig_s = float(_get_seg_value(seg, "start_time", 0.0))
        orig_e = float(_get_seg_value(seg, "end_time", 0.0))
        text = str(_get_seg_value(seg, "text", "")).strip()

        rel_s = max(0.0, orig_s - clip_start)
        rel_e = max(0.0, orig_e - clip_start)

        new_s = remap_timestamp_for_silence(rel_s, audible_segments)
        new_e = remap_timestamp_for_silence(rel_e, audible_segments)

        if new_e <= new_s:
            continue

        item: dict[str, Any] = {
            "start_time": round(new_s, 3),
            "end_time": round(new_e, 3),
            "text": text,
        }

        spk = _get_seg_value(seg, "speaker_label", None)
        if spk is not None:
            item["speaker_label"] = spk

        raw_words = _get_seg_value(seg, "words", None)
        if not raw_words and _get_seg_value(seg, "words_json", None):
            try:
                raw_words = json.loads(_get_seg_value(seg, "words_json"))
            except Exception:
                raw_words = None

        if raw_words and isinstance(raw_words, list):
            new_words = []
            for w in raw_words:
                w_text = str(_get_seg_value(w, "word", "")).strip()
                w_s = float(_get_seg_value(w, "start", orig_s))
                w_e = float(_get_seg_value(w, "end", orig_e))

                w_rel_s = max(0.0, w_s - clip_start)
                w_rel_e = max(0.0, w_e - clip_start)

                new_ws = remap_timestamp_for_silence(w_rel_s, audible_segments)
                new_we = remap_timestamp_for_silence(w_rel_e, audible_segments)

                if new_we > new_ws:
                    new_words.append({
                        "word": w_text,
                        "start": round(new_ws, 3),
                        "end": round(new_we, 3),
                    })
            if new_words:
                item["words"] = new_words

        remapped.append(item)

    return remapped


def resolve_clip_segments(
    segments: list[Any] | None,
    custom_transcript_json: str | None = None,
) -> list[Any]:
    """
    Resolve which subtitle segments to burn into the clip.
    Prioritizes custom_transcript_json if provided and non-empty.
    """
    if custom_transcript_json:
        try:
            parsed = json.loads(custom_transcript_json)
            if isinstance(parsed, list) and len(parsed) > 0:
                logger.info(
                    f"Prioritizing {len(parsed)} custom transcript segments for subtitle burning."
                )
                return parsed
        except Exception as exc:
            logger.warning(
                f"Failed to parse custom_transcript_json: {exc}. Falling back to default segments."
            )
    return segments or []


def _build_word_highlight_dialogue_lines(
    seg: Any,
    text: str,
    seg_start: float,
    seg_end: float,
    clip_start: float,
    clip_duration: float,
    max_words_per_chunk: int = 3,
    auto_emoji: bool = True,
) -> list[str]:
    """
    Viral FYP Micro-Chunking:
    Splits subtitle segments into punchy 2 to 3 word phrases with active golden/yellow
    karaoke highlight, visual enlargement tags, and contextual auto-emoji injection.
    """
    raw_words = _get_seg_value(seg, "words", None)
    if not raw_words and _get_seg_value(seg, "words_json", None):
        try:
            raw_words = json.loads(_get_seg_value(seg, "words_json"))
        except Exception:
            raw_words = None

    word_items: list[tuple[str, float, float]] = []
    if raw_words and isinstance(raw_words, list) and len(raw_words) > 0:
        for w in raw_words:
            w_text = str(_get_seg_value(w, "word", "")).strip().upper()
            if not w_text:
                continue
            w_s = float(_get_seg_value(w, "start", seg_start))
            w_e = float(_get_seg_value(w, "end", seg_end))
            word_items.append((w_text, w_s, w_e))

    if not word_items:
        tokens = text.strip().split()
        if not tokens:
            return []
        seg_dur = max(0.1, seg_end - seg_start)
        w_dur = seg_dur / len(tokens)
        for i, t in enumerate(tokens):
            w_s = seg_start + i * w_dur
            w_e = seg_start + (i + 1) * w_dur
            word_items.append((t.upper(), w_s, w_e))

    # Micro-Chunking: 2 to 4 words per chunk
    chunks: list[list[tuple[str, float, float]]] = []
    n = len(word_items)
    i = 0
    while i < n:
        rem = n - i
        if rem <= 4:
            take = rem
        elif rem in (5, 7):
            take = 3
        elif rem == 6:
            take = 3
        else:
            take = min(4, max(2, max_words_per_chunk))
        chunks.append(word_items[i : i + take])
        i += take

    dialogues: list[str] = []
    for chunk in chunks:
        if not chunk:
            continue
        chunk_start = chunk[0][1]
        chunk_end = chunk[-1][2]

        rel_start = max(0.0, chunk_start - clip_start)
        rel_end = min(clip_duration, chunk_end - clip_start)

        if rel_end <= rel_start:
            continue

        start_str = format_ass_time(rel_start)
        end_str = format_ass_time(rel_end)

        karaoke_parts = []
        for w_text, w_s, w_e in chunk:
            dur_cs = max(1, int(round((w_e - w_s) * 100)))
            emoji = get_word_emoji(w_text) if auto_emoji else None
            disp_text = f"{w_text} {emoji}" if emoji else w_text
            # Active word illuminates in bright yellow (&H0000E5FF) with instant visual pop-up scale (\fscx112\fscy112)
            karaoke_parts.append(
                f"{{\\kf{dur_cs}\\c&H0000E5FF\\fscx112\\fscy112}}{disp_text}{{\\r}}"
            )

        line_text = " ".join(karaoke_parts)
        dialogues.append(f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{line_text}")

    return dialogues


def generate_ass_subtitle_content(
    segments: list[Any],
    clip_start: float,
    clip_end: float,
    subtitle_style: str = "clean",
    play_res_x: int = 1080,
    play_res_y: int = 1920,
    custom_transcript_json: str | None = None,
    headline_text: str | None = None,
    is_streamer_split: bool = False,
    intro_hook_banner: bool = True,
    auto_emoji: bool = True,
) -> str | None:
    """
    Generate ASS file text content for a specific clip duration window.
    Timestamps are normalized so clip_start corresponds to 0:00:00.00.
    Supports top hook banner (Headline) and center split boxed hook banner (HeadlineBanner).
    """
    if subtitle_style == "none":
        return None

    resolved_segments = resolve_clip_segments(segments, custom_transcript_json)
    if not resolved_segments and not headline_text:
        return None

    clip_duration = max(0.0, clip_end - clip_start)
    if clip_duration <= 0.0:
        return None

    # Style presets configuration
    # ASS colors are in BGR order: &HAABBGGRR
    # Normalize legacy presets if present
    if subtitle_style in ("clean", "default"):
        subtitle_style = "condensed_clean"
    elif subtitle_style in ("bold_yellow", "red_punch"):
        subtitle_style = "hormozi"
    elif subtitle_style == "boxed_editorial":
        subtitle_style = "boxed_vox"

    uppercase = False
    is_karaoke = False

    if subtitle_style == "hormozi":
        font_name = "Impact, Arial Black"
        font_size = 56 if play_res_y >= 1920 else 38
        primary_color = "&H0000E5FF"    # Vibrant golden yellow
        secondary_color = "&H000000FF"
        outline_color = "&H00000000"    # Extra-thick pitch-black outline
        back_color = "&H90000000"       # Heavy drop shadow
        bold = 1
        outline = 4.5
        shadow = 3.0
        border_style = 1
        margin_v = 280 if play_res_y >= 1920 else 100
        uppercase = True

    elif subtitle_style == "boxed_vox":
        font_name = "Segoe UI Black, Arial Black, sans-serif"
        font_size = 44 if play_res_y >= 1920 else 30
        primary_color = "&H00FFFFFF"    # Crisp White
        secondary_color = "&H000000FF"
        outline_color = "&H00000000"
        back_color = "&H90141414"       # Semi-transparent dark charcoal box
        bold = 1
        outline = 8.0                   # Padding inside border box
        shadow = 0.0
        border_style = 3                # Opaque background box
        margin_v = 240 if play_res_y >= 1920 else 80
        uppercase = False

    elif subtitle_style == "cyber_neon":
        # Crisp pure white main text with thick black border and high-voltage neon lime accent (&H0000FFCC / #CCFF00)
        font_name = "Arial Black, Impact, sans-serif"
        font_size = 52 if play_res_y >= 1920 else 36
        primary_color = "&H00FFFFFF"    # Pure crisp white main text
        secondary_color = "&H0000FFCC"  # Electric / Neon Lime
        outline_color = "&H00000000"    # Thick pitch-black outline
        back_color = "&H90000000"       # Heavy drop shadow
        bold = 1
        outline = 4.5                   # Thick border 4.5
        shadow = 2.5
        border_style = 1
        margin_v = 270 if play_res_y >= 1920 else 95
        uppercase = True

    elif subtitle_style == "word_highlight":
        # Viral FYP Micro-Chunking with active golden-yellow illumination & visual pop
        font_name = "Impact, Arial Black, sans-serif"
        font_size = 56 if play_res_y >= 1920 else 38
        primary_color = "&H00FFFFFF"    # Crisp pure white main text
        secondary_color = "&H0000E5FF"  # Active spoken word glows bright yellow (&H0000E5FF)
        outline_color = "&H00000000"    # Deep black outline (Border 4.5)
        back_color = "&H90000000"       # Drop shadow
        bold = 1
        outline = 4.5                   # Sharp border 4.5
        shadow = 2.5
        border_style = 1
        margin_v = 320 if play_res_y >= 1920 else 110  # Safe zone above TikTok/Shorts UI
        uppercase = True
        is_karaoke = True

    else:  # 'condensed_clean' default
        font_name = "Bahnschrift, Arial Bold, Arial, sans-serif"
        font_size = 48 if play_res_y >= 1920 else 34
        primary_color = "&H00FFFFFF"    # Pure White
        secondary_color = "&H000000FF"
        outline_color = "&H00000000"    # Clean dark outline
        back_color = "&H80000000"       # Modern soft shadow
        bold = 1
        outline = 2.5
        shadow = 1.5
        border_style = 1
        margin_v = 240 if play_res_y >= 1920 else 80
        uppercase = False

    headline_style_line = (
        f"Style: Headline,Impact,46,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,1,0,0,0,100,100,0,0,3,10,2,8,40,40,130,1"
    )
    # HeadlineBanner: Viral TikTok boxed style (black bold text, solid white box)
    headline_banner_style_line = (
        f"Style: HeadlineBanner,Arial Black,42,&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,1,0,0,0,100,100,0,0,3,10,0,5,40,40,0,1"
    )
    # HookClean: Clean aesthetic hook title — white Impact, thick black outline, no red box.
    # Alignment=5 (center of safe zone), fades out at 1.5s.
    hook_clean_style_line = (
        f"Style: HookClean,Impact,62,&H00FFFFFF,&H000000FF,&H00000000,&HB0000000,1,0,0,0,100,100,0,0,1,5,3,5,60,60,300,1"
    )

    header = f"""[Script Info]
Title: ClipperForge Curated Short Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: {play_res_x}
PlayResY: {play_res_y}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size},{primary_color},{secondary_color},{outline_color},{back_color},{bold},0,0,0,100,100,0,0,{border_style},{outline},{shadow},2,40,40,{margin_v},1
{headline_style_line}
{headline_banner_style_line}
{hook_clean_style_line}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    dialogue_lines: list[str] = []

    # Optional headline hook banner / Intro Thumbnail Hook Card (0.0s - 1.5s)
    if headline_text and headline_text.strip():
        clean_headline = headline_text.strip().replace("\n", " ").replace("\\N", " ").upper()
        if is_streamer_split:
            # Streamer split center boundary banner persists across entire clip without fade
            clip_dur_str = format_ass_time(clip_duration)
            dialogue_lines.append(
                f"Dialogue: 1,0:00:00.00,{clip_dur_str},HeadlineBanner,,0,0,0,,{clean_headline}"
            )
        elif intro_hook_banner:
            # Clean Aesthetic Hook Title (detik 0.0 – 1.5s):
            # White Impact text at center-safe zone, thick black border+shadow, no red badge.
            # Fades out smoothly at 1.5s as normal subtitles begin.
            hook_end_sec = min(clip_duration, 1.50)
            hook_end_str = format_ass_time(hook_end_sec)
            dialogue_lines.append(
                f"Dialogue: 2,0:00:00.00,{hook_end_str},HookClean,,0,0,0,,{{\\fad(0,300)}}{clean_headline}"
            )

    for seg in resolved_segments:
        seg_start = float(_get_seg_value(seg, "start_time", 0.0))
        seg_end = float(_get_seg_value(seg, "end_time", 0.0))
        text = str(_get_seg_value(seg, "text", "")).strip()

        # Check overlap with clip window
        if seg_end <= clip_start or seg_start >= clip_end or not text:
            continue

        # Calculate offset relative to clip start
        rel_start = max(0.0, seg_start - clip_start)
        rel_end = min(clip_duration, seg_end - clip_start)

        if rel_end <= rel_start:
            continue

        if is_karaoke:
            chunk_dialogues = _build_word_highlight_dialogue_lines(
                seg=seg,
                text=text,
                seg_start=seg_start,
                seg_end=seg_end,
                clip_start=clip_start,
                clip_duration=clip_duration,
                max_words_per_chunk=3,
                auto_emoji=auto_emoji,
            )
            dialogue_lines.extend(chunk_dialogues)
        else:
            line_text = text.upper() if uppercase else text
            line_text = line_text.replace("\n", " ").replace("\\N", " ")
            if auto_emoji:
                line_text = inject_emojis_into_text(line_text)
            start_str = format_ass_time(rel_start)
            end_str = format_ass_time(rel_end)

            dialogue_lines.append(
                f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{line_text}"
            )

    if not dialogue_lines:
        return None

    return header + "\n".join(dialogue_lines) + "\n"


def build_headline_banner_dialogue(
    headline_text: str,
    clip_duration: float,
    style: str = "HeadlineBanner",
    intro_only: bool = False,
) -> str:
    """
    Format a headline hook banner dialogue line for ASS subtitles.
    """
    clean_headline = headline_text.strip().replace("\n", " ").replace("\\N", " ").upper()
    dur_sec = min(clip_duration, 3.00) if intro_only else clip_duration
    clip_dur_str = format_ass_time(dur_sec)
    fad_tag = "{\\fad(0,300)}" if intro_only else ""
    return f"Dialogue: 1,0:00:00.00,{clip_dur_str},{style},,0,0,0,,{fad_tag}{clean_headline}"


def create_clip_subtitle_file(
    segments: list[Any],
    clip_start: float,
    clip_end: float,
    output_path: Path,
    subtitle_style: str = "clean",
    play_res_x: int = 1080,
    play_res_y: int = 1920,
    custom_transcript_json: str | None = None,
    headline_text: str | None = None,
    is_streamer_split: bool = False,
    intro_hook_banner: bool = True,
    auto_emoji: bool = True,
) -> Path | None:
    """
    Generate and save an ASS subtitle file for a given clip time range.
    Returns the Path to the written file, or None if no subtitles needed.
    """
    content = generate_ass_subtitle_content(
        segments=segments,
        clip_start=clip_start,
        clip_end=clip_end,
        subtitle_style=subtitle_style,
        play_res_x=play_res_x,
        play_res_y=play_res_y,
        custom_transcript_json=custom_transcript_json,
        headline_text=headline_text,
        is_streamer_split=is_streamer_split,
        intro_hook_banner=intro_hook_banner,
        auto_emoji=auto_emoji,
    )

    if not content:
        return None

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")
    logger.info(f"Generated ASS subtitle file: {output_path}")
    return output_path
