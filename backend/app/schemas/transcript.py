"""
schemas/transcript.py — Pydantic schemas for transcription requests and segments.
"""
from __future__ import annotations

import json
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, model_validator


class WordTimestamp(BaseModel):
    word: str
    start: float
    end: float
    probability: float | None = None


class TranscriptSegmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    segment_index: int
    start_time: float
    end_time: float
    text: str
    words_json: str | None = None
    words: list[WordTimestamp] | None = None
    created_at: datetime

    @model_validator(mode="after")
    def parse_words(self) -> TranscriptSegmentRead:
        if self.words is None and self.words_json:
            try:
                parsed = json.loads(self.words_json)
                if isinstance(parsed, list):
                    self.words = [WordTimestamp(**w) for w in parsed]
            except Exception:
                self.words = []
        return self


class TranscribeRequest(BaseModel):
    """Payload to initiate video transcription."""
    model_size: str = Field(default="base", description="Whisper model size ('base', 'small', etc.)")
    language: str | None = Field(default=None, description="Optional ISO language code ('id', 'en', etc.)")


class TranscribeResponse(BaseModel):
    project_id: str
    job_id: str
    message: str = "Transcription job queued successfully."
    model_size: str


class TranscriptListResponse(BaseModel):
    project_id: str
    total_segments: int
    segments: list[TranscriptSegmentRead]
