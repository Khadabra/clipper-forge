"""
services/soundboard_service.py — Meme Soundboard & Reaction SFX Engine.

Provides:
1. Built-in procedural offline audio generators (100% local stdlib math & wave):
   - 'vine_boom': Instant 55Hz sub-bass punch with exponential decay (0.8s).
   - 'record_scratch': High-friction vinyl brake screech stopping abruptly (0.4s).
   - 'ding_bell': High-frequency dual metallic bell strike (0.5s).
   - 'crickets_silence': Short rhythmic night crickets for awkward pauses (1.5s).
   - 'bruh_thud': Low resonant muffled vocal thud (0.6s).
2. Soundboard storage management under settings.STORAGE_DIR / "soundboard".
3. Listing, retrieval, preview streaming, and custom SFX audio upload handling.
"""
from __future__ import annotations

import logging
import math
import os
import re
import struct
import wave
from pathlib import Path
from typing import Any

from app.core.config import settings

logger = logging.getLogger("clipperforge.soundboard")

# Default preset catalogue metadata
PRESET_SOUNDBOARD: list[dict[str, Any]] = [
    {
        "id": "vine_boom",
        "name": "Vine Boom",
        "category": "Impact",
        "duration": 0.8,
        "icon": "💥",
        "filename": "vine_boom.wav",
        "description": "Hentakan sub-bass instan 55Hz berdecay cepat ala meme legendaris.",
        "is_custom": False,
    },
    {
        "id": "record_scratch",
        "name": "Record Scratch",
        "category": "Transition",
        "duration": 0.4,
        "icon": "💿",
        "filename": "record_scratch.wav",
        "description": "Suara decitan vinyl berhenti mendadak saat momen tak terduga.",
        "is_custom": False,
    },
    {
        "id": "ding_bell",
        "name": "Ding Bell",
        "category": "Alert",
        "duration": 0.5,
        "icon": "🔔",
        "filename": "ding_bell.wav",
        "description": "Denting metalik nada ganda frekuensi tinggi untuk poin penting.",
        "is_custom": False,
    },
    {
        "id": "crickets_silence",
        "name": "Crickets Silence",
        "category": "Awkward",
        "duration": 1.5,
        "icon": "🦗",
        "filename": "crickets_silence.wav",
        "description": "Suara ritme jangkrik malam pendek pengisi jeda hening / garing.",
        "is_custom": False,
    },
    {
        "id": "bruh_thud",
        "name": "Bruh Thud",
        "category": "Reaction",
        "duration": 0.6,
        "icon": "🗿",
        "filename": "bruh_thud.wav",
        "description": "Nada vokal rendah teredam bergaya Bruh Sound Effect.",
        "is_custom": False,
    },
]


def get_soundboard_dir() -> Path:
    """Ensure and return the backend soundboard storage directory."""
    soundboard_dir = settings.STORAGE_DIR / "soundboard"
    soundboard_dir.mkdir(parents=True, exist_ok=True)
    return soundboard_dir


def _write_pcm_wave(
    path: Path, frames: bytearray, sample_rate: int = 44100, channels: int = 2
) -> Path:
    """Helper to write raw 16-bit PCM stereo frames to a valid WAV file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(frames)
    return path


def generate_vine_boom(output_path: Path) -> Path:
    """
    Generate an instant 55Hz sub-bass boom with quick exponential decay (0.8s).
    Instant punch, 55Hz fundamental with soft saturation harmonics and rapid drop.
    """
    sample_rate = 44100
    duration = 0.8
    total_samples = int(sample_rate * duration)
    frames = bytearray()

    phase = 0.0
    for i in range(total_samples):
        t = i / sample_rate
        # Fast exponential decay envelope
        env = math.exp(-5.2 * t)

        # Slight initial pitch drop: 62Hz down to 52Hz
        freq = 52.0 + 10.0 * math.exp(-25.0 * t)
        phase += 2.0 * math.pi * freq / sample_rate

        # Fundamental + saturation overtones (sub-bass weight)
        sine = math.sin(phase)
        # Soft saturation distortion for punchiness
        sub_tone = 0.70 * sine + 0.25 * math.sin(2.0 * phase) + 0.12 * math.sin(3.0 * phase)
        # Saturated soft clip
        sig = math.tanh(sub_tone * 1.6) * env * 0.95

        # Fade out end to avoid clicking
        if t > 0.75:
            sig *= (duration - t) / 0.05

        val = int(max(-32767, min(32767, sig * 32767)))
        frames.extend(struct.pack("<hh", val, val))

    return _write_pcm_wave(output_path, frames, sample_rate, 2)


def generate_record_scratch(output_path: Path) -> Path:
    """
    Generate a vinyl needle scratch brake stopping abruptly (0.4s).
    Rapid downward pitch sweep (1800Hz -> 200Hz) with high-frequency flutter, cut dead at 0.4s.
    """
    sample_rate = 44100
    duration = 0.4
    total_samples = int(sample_rate * duration)
    frames = bytearray()

    phase = 0.0
    for i in range(total_samples):
        t = i / sample_rate
        norm_t = min(1.0, t / duration)

        # Downward pitch sweep with braking friction curve
        freq = 200.0 + 1600.0 * ((1.0 - norm_t) ** 2.2)
        # Vinyl friction modulation (FM flutter)
        flutter = 1.0 + 0.18 * math.sin(2.0 * math.pi * 120.0 * t)
        phase += 2.0 * math.pi * (freq * flutter) / sample_rate

        # Scratch texture: carrier + gritty odd harmonics
        scratch = (
            0.55 * math.sin(phase)
            + 0.25 * math.sin(3.0 * phase)
            + 0.15 * math.sin(5.0 * phase)
        )

        # Sharp envelope: rapid attack, sustained friction, abrupt stop at 0.38s
        if t < 0.02:
            env = t / 0.02
        elif t > 0.36:
            env = max(0.0, (duration - t) / 0.04)
        else:
            env = 1.0 - 0.25 * norm_t

        sig = scratch * env * 0.85
        val = int(max(-32767, min(32767, sig * 32767)))
        frames.extend(struct.pack("<hh", val, val))

    return _write_pcm_wave(output_path, frames, sample_rate, 2)


def generate_ding_bell(output_path: Path) -> Path:
    """
    Generate a dual-tone high-frequency metallic bell strike (0.5s).
    High frequencies: 2093.0Hz (C7) and 2793.8Hz (F7) + high shimmer (4186Hz), fast attack, ringing decay.
    """
    sample_rate = 44100
    duration = 0.5
    total_samples = int(sample_rate * duration)
    frames = bytearray()

    f1 = 2093.0  # C7
    f2 = 2793.8  # F7
    f3 = 4186.0  # C8 shimmer

    for i in range(total_samples):
        t = i / sample_rate
        # Bell exponential decay
        env = math.exp(-6.5 * t)
        shimmer_env = math.exp(-12.0 * t)

        tone = (
            0.50 * math.sin(2.0 * math.pi * f1 * t)
            + 0.40 * math.sin(2.0 * math.pi * f2 * t)
            + 0.15 * math.sin(2.0 * math.pi * f3 * t) * shimmer_env
        )

        # Immediate attack (1ms)
        attack = min(1.0, t / 0.002)
        sig = tone * env * attack * 0.88

        val = int(max(-32767, min(32767, sig * 32767)))
        frames.extend(struct.pack("<hh", val, val))

    return _write_pcm_wave(output_path, frames, sample_rate, 2)


def generate_crickets_silence(output_path: Path) -> Path:
    """
    Generate short night crickets rhythm (1.5s) for awkward pauses or quiet comedy beats.
    3 distinct high-frequency chirps (~4600Hz carrier with 65Hz pulsed envelope), separated by silence.
    """
    sample_rate = 44100
    duration = 1.5
    total_samples = int(sample_rate * duration)
    frames = bytearray()

    carrier_freq = 4600.0

    # Chirp time windows: [0.08 - 0.32], [0.48 - 0.72], [0.88 - 1.12], then silence until 1.5s
    chirps = [(0.08, 0.32), (0.48, 0.72), (0.88, 1.12)]

    for i in range(total_samples):
        t = i / sample_rate

        chirp_amp = 0.0
        for start, end in chirps:
            if start <= t <= end:
                chirp_t = t - start
                chirp_dur = end - start
                # 65Hz rapid pulse modulation inside chirp
                pulse = 0.5 * (1.0 + math.sin(2.0 * math.pi * 65.0 * chirp_t))
                # Window envelope
                win = math.sin(math.pi * (chirp_t / chirp_dur))
                chirp_amp = pulse * win
                break

        # Carrier wave + subtle overtone
        tone = (
            0.75 * math.sin(2.0 * math.pi * carrier_freq * t)
            + 0.25 * math.sin(2.0 * math.pi * (carrier_freq * 1.5) * t)
        )
        sig = tone * chirp_amp * 0.75

        val = int(max(-32767, min(32767, sig * 32767)))
        frames.extend(struct.pack("<hh", val, val))

    return _write_pcm_wave(output_path, frames, sample_rate, 2)


def generate_bruh_thud(output_path: Path) -> Path:
    """
    Generate a low muffled resonant vocal thud (0.6s) reminiscent of the classic 'Bruh' effect.
    Formants at 115Hz dropping to 75Hz, with low-pass vowel resonance and soft impact envelope.
    """
    sample_rate = 44100
    duration = 0.6
    total_samples = int(sample_rate * duration)
    frames = bytearray()

    phase1 = 0.0
    phase2 = 0.0

    for i in range(total_samples):
        t = i / sample_rate
        # Formant frequencies sliding down
        f1 = 75.0 + 40.0 * math.exp(-6.0 * t)
        f2 = f1 * 2.8  # vowel formant harmonic

        phase1 += 2.0 * math.pi * f1 / sample_rate
        phase2 += 2.0 * math.pi * f2 / sample_rate

        # Envelope: punchy rise (15ms), resonant muffled sustain and decay
        if t < 0.015:
            env = t / 0.015
        else:
            env = math.exp(-4.8 * (t - 0.015))

        # Vocal-like muffled formant
        tone = 0.75 * math.sin(phase1) + 0.25 * math.sin(phase2)
        # Soft warmth
        sig = math.tanh(tone * 1.4) * env * 0.90

        if t > 0.55:
            sig *= (duration - t) / 0.05

        val = int(max(-32767, min(32767, sig * 32767)))
        frames.extend(struct.pack("<hh", val, val))

    return _write_pcm_wave(output_path, frames, sample_rate, 2)


def ensure_default_soundboard_tracks() -> None:
    """Verify that all default procedural soundboard SFX tracks exist; generate any that are missing."""
    sb_dir = get_soundboard_dir()
    generators = {
        "vine_boom": generate_vine_boom,
        "record_scratch": generate_record_scratch,
        "ding_bell": generate_ding_bell,
        "crickets_silence": generate_crickets_silence,
        "bruh_thud": generate_bruh_thud,
    }

    for preset in PRESET_SOUNDBOARD:
        sound_id = preset["id"]
        file_path = sb_dir / preset["filename"]
        if not file_path.exists() or file_path.stat().st_size == 0:
            gen_func = generators.get(sound_id)
            if gen_func:
                logger.info(f"Generating default SFX track: '{sound_id}' -> {file_path}")
                try:
                    gen_func(file_path)
                except Exception as exc:
                    logger.error(f"Failed to generate SFX track '{sound_id}': {exc}")


def list_soundboard_sounds(api_prefix: str = "/api/soundboard") -> list[dict[str, Any]]:
    """
    Return all available Soundboard SFX tracks (built-in presets and user-uploaded files).
    Automatically initializes preset audio files if not present.
    """
    ensure_default_soundboard_tracks()
    sb_dir = get_soundboard_dir()

    results: list[dict[str, Any]] = []

    # 1. Preset tracks
    preset_filenames = set()
    for preset in PRESET_SOUNDBOARD:
        sound_id = preset["id"]
        preset_filenames.add(preset["filename"])
        file_path = sb_dir / preset["filename"]
        results.append({
            "id": sound_id,
            "name": preset["name"],
            "category": preset["category"],
            "duration": preset["duration"],
            "icon": preset["icon"],
            "filename": preset["filename"],
            "file_url": f"{api_prefix}/{sound_id}/stream",
            "description": preset["description"],
            "is_custom": False,
            "exists": file_path.exists(),
        })

    # 2. Custom uploaded audio files in sb_dir
    supported_exts = {".mp3", ".wav", ".m4a", ".aac", ".ogg"}
    for f in sb_dir.iterdir():
        if f.is_file() and f.suffix.lower() in supported_exts:
            if f.name in preset_filenames:
                continue
            custom_id = f.stem
            clean_name = re.sub(r"[_\-]+", " ", f.stem).title()
            results.append({
                "id": custom_id,
                "name": clean_name,
                "category": "Custom SFX",
                "duration": 1.0,
                "icon": "🔊",
                "filename": f.name,
                "file_url": f"{api_prefix}/{custom_id}/stream",
                "description": f"Custom audio SFX: {f.name}",
                "is_custom": True,
                "exists": True,
            })

    return results


def get_sound_file_path(sound_id: str) -> Path | None:
    """Resolve the local filesystem Path of an SFX sound given its ID or filename."""
    ensure_default_soundboard_tracks()
    sb_dir = get_soundboard_dir()

    # 1. Match by preset catalog ID
    for preset in PRESET_SOUNDBOARD:
        if preset["id"] == sound_id:
            p = sb_dir / preset["filename"]
            if p.exists():
                return p

    # 2. Match direct filename
    direct = sb_dir / sound_id
    if direct.exists() and direct.is_file():
        return direct

    # 3. Match stem for custom uploads (e.g. sound_id without extension)
    for f in sb_dir.iterdir():
        if f.is_file() and f.stem == sound_id:
            return f

    return None


def save_custom_sound(
    filename: str,
    content: bytes,
    display_name: str | None = None,
) -> dict[str, Any]:
    """
    Save user-uploaded sound effect file to the soundboard directory.
    Validates audio file extension (.mp3, .wav, etc.) and returns metadata.
    """
    sb_dir = get_soundboard_dir()
    clean_stem = re.sub(r"[^a-zA-Z0-9_\-]", "_", Path(filename).stem)[:48].strip("_")
    ext = Path(filename).suffix.lower()
    if ext not in {".mp3", ".wav", ".m4a", ".aac", ".ogg"}:
        raise ValueError(f"Format audio '{ext}' tidak didukung. Gunakan MP3 atau WAV.")

    dest_filename = f"sfx_{clean_stem}{ext}"
    dest_path = sb_dir / dest_filename
    dest_path.write_bytes(content)

    sound_id = dest_path.stem
    name = (
        display_name.strip()
        if display_name and display_name.strip()
        else clean_stem.replace("_", " ").title()
    )

    return {
        "id": sound_id,
        "name": name,
        "category": "Custom SFX",
        "duration": 1.0,
        "icon": "🔊",
        "filename": dest_filename,
        "file_url": f"/api/soundboard/{sound_id}/stream",
        "description": f"Custom SFX: {dest_filename}",
        "is_custom": True,
        "exists": True,
    }
