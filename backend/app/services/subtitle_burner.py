"""
services/subtitle_burner.py — Dynamic subtitle generation and styling (ASS format).

Transforms timestamped transcript segments into styled subtitle files (.ass)
specifically clipped and offset for short-form video exports (9:16, 1:1, 16:9).
Supports custom transcript overrides per-clip and rich visual presets:
- clean (crisp minimalist white)
- bold_yellow (high-contrast viral yellow)
- boxed_editorial (Vox/documentary boxed background)
- cyber_neon (cyan & magenta outline gaming/podcast)
- red_punch (bold white with fiery red outline)
- word_highlight (active karaoke-style word illumination)
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("clipperforge.subtitle_burner")


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


def _format_word_highlight(
    seg: Any,
    text: str,
    seg_start: float,
    seg_end: float,
) -> str:
    """
    Format words into ASS karaoke tags (\\kf<centiseconds>) using word timestamps if available.
    """
    raw_words = _get_seg_value(seg, "words", None)
    if not raw_words and _get_seg_value(seg, "words_json", None):
        try:
            raw_words = json.loads(_get_seg_value(seg, "words_json"))
        except Exception:
            raw_words = None

    if raw_words and isinstance(raw_words, list) and len(raw_words) > 0:
        karaoke_parts = []
        for w in raw_words:
            w_text = str(_get_seg_value(w, "word", "")).strip().upper()
            if not w_text:
                continue
            w_s = float(_get_seg_value(w, "start", seg_start))
            w_e = float(_get_seg_value(w, "end", seg_end))
            duration_cs = max(1, int(round((w_e - w_s) * 100)))
            karaoke_parts.append(f"{{\\kf{duration_cs}}}{w_text}")
        if karaoke_parts:
            return " ".join(karaoke_parts)

    tokens = text.strip().split()
    if not tokens:
        return text.upper()
    total_duration = max(0.1, seg_end - seg_start)
    per_word_cs = max(1, int(round((total_duration / len(tokens)) * 100)))
    return " ".join(f"{{\\kf{per_word_cs}}}{t.upper()}" for t in tokens)


def generate_ass_subtitle_content(
    segments: list[Any],
    clip_start: float,
    clip_end: float,
    subtitle_style: str = "clean",
    play_res_x: int = 1080,
    play_res_y: int = 1920,
    custom_transcript_json: str | None = None,
    headline_text: str | None = None,
) -> str | None:
    """
    Generate ASS file text content for a specific clip duration window.
    Timestamps are normalized so clip_start corresponds to 0:00:00.00.
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
        font_size = 54 if play_res_y >= 1920 else 38
        primary_color = "&H0000E5FF"    # Vibrant golden yellow
        secondary_color = "&H000000FF"
        outline_color = "&H00000000"    # Thick pitch-black outline
        back_color = "&H00000000"       # Heavy drop shadow
        bold = 1
        outline = 4.0
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
        font_name = "Impact, Arial Black"
        font_size = 52 if play_res_y >= 1920 else 36
        primary_color = "&H00FFFF00"    # Vivid Cyan
        secondary_color = "&H00FF00FF"
        outline_color = "&H00D000A0"    # Thick Hot Magenta outline
        back_color = "&HA0200020"       # Dark violet shadow
        bold = 1
        outline = 3.8
        shadow = 2.5
        border_style = 1
        margin_v = 270 if play_res_y >= 1920 else 95
        uppercase = True

    elif subtitle_style == "word_highlight":
        font_name = "Impact, Arial Black"
        font_size = 50 if play_res_y >= 1920 else 34
        primary_color = "&H00FFFFFF"    # Base inactive word white
        secondary_color = "&H0000E5FF"  # Active highlighted word bright gold
        outline_color = "&H00000000"    # Black outline
        back_color = "&H90000000"       # Drop shadow
        bold = 1
        outline = 3.5
        shadow = 2.0
        border_style = 1
        margin_v = 270 if play_res_y >= 1920 else 95
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
        f"Style: Headline,Arial Black,42,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,1,0,0,0,100,100,0,0,3,8,2,8,40,40,130,1"
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

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    dialogue_lines: list[str] = []

    # Optional top headline banner (for framed_headline or hook highlight)
    if headline_text and headline_text.strip():
        clean_headline = headline_text.strip().replace("\n", " ").replace("\\N", " ")
        clip_dur_str = format_ass_time(clip_duration)
        dialogue_lines.append(
            f"Dialogue: 1,0:00:00.00,{clip_dur_str},Headline,,0,0,0,,{clean_headline}"
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
            line_text = _format_word_highlight(
                seg=seg,
                text=text,
                seg_start=seg_start,
                seg_end=seg_end,
            )
        else:
            line_text = text.upper() if uppercase else text
            line_text = line_text.replace("\n", " ").replace("\\N", " ")

        start_str = format_ass_time(rel_start)
        end_str = format_ass_time(rel_end)

        dialogue_lines.append(
            f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{line_text}"
        )

    if not dialogue_lines:
        return None

    return header + "\n".join(dialogue_lines) + "\n"


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
    )

    if not content:
        return None

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")
    logger.info(f"Generated ASS subtitle file: {output_path}")
    return output_path
