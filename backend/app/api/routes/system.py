import os
import platform
import shutil
import subprocess
from fastapi import APIRouter

router = APIRouter()


def check_binary(binary_name: str) -> dict:
    """Safely check if a binary is available via subprocess without crashing."""
    try:
        proc = subprocess.run(
            [binary_name, "-version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=2,
            shell=False,
        )
        if proc.returncode == 0:
            first_line = proc.stdout.splitlines()[0] if proc.stdout else ""
            return {
                "available": True,
                "version": first_line.strip(),
                "path": shutil.which(binary_name),
            }
        else:
            return {
                "available": False,
                "version": None,
                "error": proc.stderr.strip() or f"Exited with code {proc.returncode}",
            }
    except (FileNotFoundError, OSError):
        return {
            "available": False,
            "version": None,
            "error": f"'{binary_name}' was not found in system PATH.",
        }
    except Exception as e:
        return {
            "available": False,
            "version": None,
            "error": str(e),
        }


def get_disk_info(path: str = ".") -> dict:
    """Return storage metrics in gigabytes."""
    try:
        total, used, free = shutil.disk_usage(path)
        total_gb = round(total / (1024**3), 2)
        used_gb = round(used / (1024**3), 2)
        free_gb = round(free / (1024**3), 2)
        free_percent = round((free / total) * 100, 1) if total > 0 else 0.0
        return {
            "total_gb": total_gb,
            "used_gb": used_gb,
            "free_gb": free_gb,
            "free_percent": free_percent,
            "path": os.path.abspath(path),
        }
    except Exception as e:
        return {
            "error": str(e),
            "free_gb": 0.0,
            "total_gb": 0.0,
        }


@router.get("/system/check")
def get_system_check():
    ffmpeg_info = check_binary("ffmpeg")
    ffprobe_info = check_binary("ffprobe")
    disk_info = get_disk_info(".")
    
    python_info = {
        "version": platform.python_version(),
        "compiler": platform.python_compiler(),
        "system": platform.system(),
        "release": platform.release(),
    }

    # Ready if ffmpeg is available and free disk space is at least 1 GB
    is_ready = ffmpeg_info["available"] and disk_info.get("free_gb", 0) > 1.0

    return {
        "status": "ready" if is_ready else "degraded",
        "ffmpeg": ffmpeg_info,
        "ffprobe": ffprobe_info,
        "python": python_info,
        "disk_space": disk_info,
        "guidance": (
            None
            if ffmpeg_info["available"]
            else "FFmpeg is required for video clipping. On Windows, install via: 'winget install Gyan.FFmpeg' or place ffmpeg.exe in your PATH."
        ),
    }
