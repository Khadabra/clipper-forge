"""
routes/music.py — REST API endpoints for Background Music (BGM) Library & Uploads.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.services.music_service import (
    get_music_track_path,
    list_music_tracks,
    save_custom_music_track,
)

logger = logging.getLogger("clipperforge.music_route")

router = APIRouter(tags=["Music"])


class MusicTrackItem(BaseModel):
    id: str
    name: str
    category: str
    duration: float
    filename: str
    file_url: str
    description: str | None = None
    is_custom: bool = False
    exists: bool = True


class MusicListResponse(BaseModel):
    total_tracks: int
    tracks: list[MusicTrackItem]


@router.get(
    "/music",
    response_model=MusicListResponse,
    summary="List available background music (BGM) tracks",
)
def get_music_tracks() -> MusicListResponse:
    """Return all preset BGM and custom uploaded audio tracks."""
    tracks = list_music_tracks()
    items = [MusicTrackItem(**t) for t in tracks]
    return MusicListResponse(total_tracks=len(items), tracks=items)


@router.get(
    "/music/{track_id}/stream",
    summary="Stream or download a background music track",
)
def stream_music_track(track_id: str) -> FileResponse:
    """Stream audio track for live studio preview playback."""
    file_path = get_music_track_path(track_id)
    if not file_path or not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Track audio '{track_id}' tidak ditemukan.",
        )

    ext = file_path.suffix.lower()
    media_types = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".ogg": "audio/ogg",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=file_path.name,
    )


@router.post(
    "/music/upload",
    response_model=MusicTrackItem,
    status_code=status.HTTP_201_CREATED,
    summary="Upload custom background music file (MP3 / WAV)",
)
async def upload_music_track(
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
) -> MusicTrackItem:
    """Upload custom BGM audio file to local music library."""
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nama file audio tidak boleh kosong.",
        )

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File audio kosong.",
        )

    try:
        track_info = save_custom_music_track(
            filename=file.filename,
            content=content,
            display_name=name,
        )
        return MusicTrackItem(**track_info)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        )
    except Exception as exc:
        logger.error(f"Error uploading music file: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal mengunggah file musik: {exc}",
        )
