"""
routes/soundboard.py — REST API endpoints for Meme Soundboard & Reaction SFX Engine.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.services.soundboard_service import (
    get_sound_file_path,
    list_soundboard_sounds,
    save_custom_sound,
)

logger = logging.getLogger("clipperforge.soundboard_route")

router = APIRouter(tags=["Soundboard"])


class SoundboardItem(BaseModel):
    id: str
    name: str
    category: str
    duration: float
    icon: str
    filename: str
    file_url: str
    description: str | None = None
    is_custom: bool = False
    exists: bool = True


@router.get(
    "/soundboard",
    response_model=list[SoundboardItem],
    summary="List available meme soundboard & reaction SFX",
)
def get_soundboard_sounds() -> list[SoundboardItem]:
    """Return all preset meme sound effects and custom uploaded SFX audio clips."""
    sounds = list_soundboard_sounds()
    return [SoundboardItem(**s) for s in sounds]


@router.get(
    "/soundboard/{sound_id}/stream",
    summary="Stream or download a meme soundboard audio file",
)
def stream_soundboard_sound(sound_id: str) -> FileResponse:
    """Stream sound audio for live studio preview playback."""
    file_path = get_sound_file_path(sound_id)
    if not file_path or not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Suara SFX '{sound_id}' tidak ditemukan.",
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
    "/soundboard/upload",
    response_model=SoundboardItem,
    status_code=status.HTTP_201_CREATED,
    summary="Upload custom reaction sound effect file (MP3 / WAV)",
)
async def upload_soundboard_sound(
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
) -> SoundboardItem:
    """Upload custom SFX audio file to local soundboard library."""
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
        sound_info = save_custom_sound(
            filename=file.filename,
            content=content,
            display_name=name,
        )
        return SoundboardItem(**sound_info)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        )
    except Exception as exc:
        logger.error(f"Error uploading SFX sound file: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal mengunggah file SFX: {exc}",
        )
