"""
schemas/clip.py — Pydantic schemas for AI-curated clip candidates & export pipeline.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class ClipSubtitleSegment(BaseModel):
    """Timestamped segment representing an editable line of subtitle in a clip."""
    start_time: float = Field(..., ge=0.0)
    end_time: float = Field(..., ge=0.0)
    text: str = Field(..., min_length=1)
    id: str | None = None
    segment_index: int | None = None
    speaker_label: str | None = None


class ClipCandidateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    title: str
    hook: str
    rationale: str
    start_time: float
    end_time: float
    virality_score: int
    category: str
    status: str
    rendered_file_path: str | None = None
    aspect_ratio: str = "9:16"
    subtitle_style: str = "condensed_clean"
    crop_mode: str = "blur_fill"
    auto_zoom: str = "subtle"
    custom_transcript_json: str | None = None
    render_status: str = "idle"
    crop_x_pct: float = 0.50
    remove_silence: bool = False
    auto_emoji: bool = True
    tracking_mode: str = "active_speaker"
    tracking_confidence: float = 1.0
    tracking_fallback_reason: str | None = None
    quality_report_json: str | None = None
    subscores_json: str | None = None
    starts_mid_sentence: bool = False
    ends_abruptly: bool = False
    intro_hook_banner: bool = True
    show_hook_banner: bool = True
    cover_file_path: str | None = None
    bgm_track_id: str | None = None
    bgm_volume: float = 0.18
    social_copy_json: str | None = None
    soundboard_cues_json: str | None = "[]"
    created_at: datetime

    @property
    def duration(self) -> float:
        return max(0.0, round(self.end_time - self.start_time, 2))


class ClipCandidateUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    start_time: float | None = Field(default=None, ge=0.0)
    end_time: float | None = Field(default=None, ge=0.0)
    status: str | None = Field(default=None, pattern="^(suggested|approved|rejected)$")
    aspect_ratio: str | None = Field(default=None, pattern="^(9:16|1:1|4:5|16:9)$")
    subtitle_style: str | None = Field(
        default=None,
        pattern="^(hormozi|condensed_clean|boxed_vox|cyber_neon|word_highlight|none)$",
    )
    crop_mode: str | None = Field(
        default=None,
        pattern="^(blur_fill|center_crop|framed_headline|speaker_track|streamer_split|reframe|single_speaker|active_speaker|split_screen|manual_reframe)$",
    )
    auto_zoom: str | None = Field(
        default=None,
        pattern="^(none|subtle|snap_hook|jump_cut)$",
    )
    custom_transcript_json: str | None = None
    intro_hook_banner: bool | None = None
    show_hook_banner: bool | None = None
    framing_offset_pct: float | None = Field(default=0.0, ge=-0.5, le=0.5)
    crop_x_pct: float | None = Field(default=None, ge=0.0, le=1.0)
    remove_silence: bool | None = Field(default=None)
    auto_emoji: bool | None = Field(default=None)
    enable_sfx: bool | None = Field(default=True)
    bgm_track_id: str | None = None
    bgm_volume: float | None = Field(default=None, ge=0.0, le=1.0)
    social_copy_json: str | None = None
    soundboard_cues_json: str | None = None
    tracking_mode: str | None = Field(
        default=None,
        pattern="^(single_speaker|active_speaker|split_screen|manual_reframe|blur_fill|center_crop|framed_headline|speaker_track|streamer_split|reframe)$",
    )
    tracking_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    tracking_fallback_reason: str | None = None
    quality_report_json: str | None = None
    subscores_json: str | None = None
    starts_mid_sentence: bool = False
    ends_abruptly: bool = False


class FindClipsResponse(BaseModel):
    project_id: str
    job_id: str
    message: str = "AI Clip Finder job queued successfully."


class ClipListResponse(BaseModel):
    project_id: str
    total_clips: int
    clips: list[ClipCandidateRead]


class ManualClipCreateRequest(BaseModel):
    title: str = Field(default="Klip Baru (Manual)", max_length=255)
    start_time: float = Field(default=0.0, ge=0.0)
    end_time: float | None = Field(default=None, ge=0.0)
    aspect_ratio: str = Field(default="9:16", pattern="^(9:16|1:1|4:5|16:9)$")
    subtitle_style: str = Field(
        default="condensed_clean",
        pattern="^(hormozi|condensed_clean|boxed_vox|cyber_neon|word_highlight|none)$",
    )
    crop_mode: str = Field(
        default="blur_fill",
        pattern="^(blur_fill|center_crop|framed_headline|speaker_track|streamer_split|reframe|single_speaker|active_speaker|split_screen|manual_reframe)$",
    )
    auto_zoom: str = Field(
        default="subtle",
        pattern="^(none|subtle|snap_hook|jump_cut)$",
    )


class ClipRenderRequest(BaseModel):
    aspect_ratio: str | None = Field(default=None, pattern="^(9:16|1:1|4:5|16:9)$")
    subtitle_style: str | None = Field(
        default=None,
        pattern="^(hormozi|condensed_clean|boxed_vox|cyber_neon|word_highlight|none)$",
    )
    crop_mode: str | None = Field(
        default=None,
        pattern="^(blur_fill|center_crop|framed_headline|speaker_track|streamer_split|reframe|single_speaker|active_speaker|split_screen|manual_reframe)$",
    )
    auto_zoom: str | None = Field(
        default=None,
        pattern="^(none|subtle|snap_hook|jump_cut)$",
    )
    intro_hook_banner: bool | None = None
    show_hook_banner: bool | None = None
    enable_sfx: bool | None = None
    framing_offset_pct: float | None = Field(default=None, ge=-0.5, le=0.5)
    crop_x_pct: float | None = Field(default=None, ge=0.0, le=1.0)
    remove_silence: bool | None = None
    auto_emoji: bool | None = None
    tracking_mode: str | None = Field(
        default=None,
        pattern="^(single_speaker|active_speaker|split_screen|manual_reframe|blur_fill|center_crop|framed_headline|speaker_track|streamer_split|reframe)$",
    )
    bgm_track_id: str | None = None
    bgm_volume: float | None = Field(default=None, ge=0.0, le=1.0)
    soundboard_cues: list[dict[str, Any]] | None = None
    soundboard_cues_json: str | None = None


class ClipRenderResponse(BaseModel):
    clip_id: str
    job_id: str
    message: str = "Rendering job scheduled successfully."


class TitleAnalysisRequest(BaseModel):
    title: str | None = None


class SEOCheckItem(BaseModel):
    id: str
    label: str
    status: str
    score: int
    max_score: int
    message: str
    tip: str


class TitleAnalysisResponse(BaseModel):
    title: str
    score: int
    rating: str
    char_count: int
    word_count: int
    matched_power_words: list[str] = Field(default_factory=list)
    checklist: list[SEOCheckItem] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)


class TitleRecommendationItem(BaseModel):
    title: str
    score: int
    rating: str
    matched_power_words: list[str] = Field(default_factory=list)


class TitleRecommendationsResponse(BaseModel):
    clip_id: str
    recommendations: list[TitleRecommendationItem] = Field(default_factory=list)


class SocialCopyItem(BaseModel):
    platform: str
    title: str
    hook: str
    caption: str
    hashtags: list[str] = Field(default_factory=list)
    cta: str
    full_formatted_text: str


class SocialCopyRequest(BaseModel):
    platform: str = Field(default="all", pattern="^(all|tiktok|shorts|reels)$")
    custom_topic: str | None = None


class SocialCopyResponse(BaseModel):
    clip_id: str
    copies: dict[str, SocialCopyItem]


