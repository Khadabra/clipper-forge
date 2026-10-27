"""
services/youtube_downloader.py — YouTube video ingestion service using yt-dlp.

Features:
- YouTube URL validation (youtube.com, youtu.be, shorts, live).
- Fast metadata inspection without downloading full media.
- Max 1080p MP4 download with progress hook reporting.
- Cooperative cancellation via threading.Event.
"""
from __future__ import annotations

import logging
import re
import shutil
import threading
from pathlib import Path
from typing import Any, Callable

import yt_dlp

logger = logging.getLogger("clipperforge.youtube")

# Pattern covering standard watch, youtu.be, shorts, and live URLs
YOUTUBE_URL_REGEX = re.compile(
    r"^(https?://)?(www\.|m\.)?(youtube\.com/(watch\?.*v=|shorts/|live/)|youtu\.be/)([\w-]{11})([?&].*)?$",
    re.IGNORECASE,
)


def is_valid_youtube_url(url: str) -> bool:
    """Validate whether a string is a recognized YouTube video URL."""
    if not url or not isinstance(url, str):
        return False
    return bool(YOUTUBE_URL_REGEX.match(url.strip()))


def extract_video_id(url: str) -> str | None:
    """Extract the 11-character video ID from a YouTube URL."""
    if not url:
        return None
    match = YOUTUBE_URL_REGEX.match(url.strip())
    if match:
        return match.group(5)
    return None


def get_youtube_metadata(url: str) -> dict[str, Any]:
    """
    Extract video title, duration, and thumbnail without downloading media.
    """
    ydl_opts = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url.strip(), download=False)
        return {
            "id": info.get("id"),
            "title": info.get("title") or "YouTube Video",
            "duration": info.get("duration"),
            "thumbnail": info.get("thumbnail"),
            "uploader": info.get("uploader"),
            "view_count": info.get("view_count"),
        }


def download_youtube_video(
    url: str,
    output_path: Path,
    on_progress: Callable[[float], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> Path:
    """
    Download video from YouTube using yt-dlp (up to 1080p, MP4 prefered).
    Reports progress 0.0 - 100.0 via on_progress callback.
    Raises Exception if cancelled.
    Returns the final Path of the downloaded file.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_prefix = output_path.parent / "temp_yt"

    def progress_hook(d: dict[str, Any]) -> None:
        if cancel_event and cancel_event.is_set():
            raise Exception("Download cancelled by user")

        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            if total > 0 and on_progress:
                pct = min(99.0, max(0.0, (downloaded / total) * 100.0))
                on_progress(pct)
        elif status == "finished":
            if on_progress:
                on_progress(100.0)

    ydl_opts = {
        # Best video <= 1080p + best audio, fallback to single stream
        "format": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
        "merge_output_format": "mp4",
        "outtmpl": f"{temp_prefix}.%(ext)s",
        "progress_hooks": [progress_hook],
        "quiet": True,
        "no_warnings": True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url.strip()])

    if cancel_event and cancel_event.is_set():
        raise Exception("Download cancelled by user")

    # Find the downloaded temporary file
    candidate_files = list(output_path.parent.glob("temp_yt.*"))
    if not candidate_files:
        if output_path.exists():
            return output_path
        raise FileNotFoundError(f"Failed to find downloaded YouTube file for {url}")

    downloaded_file = candidate_files[0]

    # Move/replace to target output_path
    if output_path.exists():
        output_path.unlink()
    shutil.move(str(downloaded_file), str(output_path))

    return output_path
