"""
services/music_service.py — Background Music (BGM) Library & Procedural Sound Generator.

Provides:
1. Preset loopable audio generators (100% offline, local stdlib math & wave):
   - 'lofi_chill': Warm acoustic / lofi pad chords (Cmaj7 - Am7 - Dm7 - G7) with soft vinyl warmth.
   - 'comedy_quirky': Playful syncopated comedic bounce / marimba pizzicato motif.
   - 'suspense_tension': Deep dramatic sub-bass drone with eerie beating harmonics.
2. File storage management under settings.STORAGE_DIR / "music".
3. Track listing, retrieval, and custom audio upload handling.
"""
from __future__ import annotations

import logging
import math
import re
import struct
import wave
from pathlib import Path
from typing import Any

from app.core.config import settings

logger = logging.getLogger("clipperforge.music")

# Default preset catalogue metadata
PRESET_CATALOGUE: list[dict[str, Any]] = [
    {
        "id": "lofi_chill",
        "name": "Lo-Fi Warm Acoustic",
        "category": "Relaxed & Podcast",
        "duration": 12.0,
        "filename": "lofi_chill.wav",
        "description": "Warm acoustic chords & relaxing melody, ideal for deep conversations & life advice.",
        "is_custom": False,
    },
    {
        "id": "comedy_quirky",
        "name": "Comedy Quirky Bounce",
        "category": "Humor & Entertainment",
        "duration": 8.0,
        "filename": "comedy_quirky.wav",
        "description": "Light, syncopated comedic rhythm for funny clips, witty banter, and jokes.",
        "is_custom": False,
    },
    {
        "id": "suspense_tension",
        "name": "Dramatic Tension Drone",
        "category": "Suspense & Mystery",
        "duration": 10.0,
        "filename": "suspense_tension.wav",
        "description": "Deep cinematic tension hum and eerie suspense, perfect for thrillers and revelations.",
        "is_custom": False,
    },
]


def get_music_dir() -> Path:
    """Ensure and return the backend music storage directory."""
    music_dir = settings.STORAGE_DIR / "music"
    music_dir.mkdir(parents=True, exist_ok=True)
    return music_dir


def _write_pcm_wave(path: Path, frames: bytearray, sample_rate: int = 44100, channels: int = 2) -> Path:
    """Helper to write raw 16-bit PCM stereo frames to a valid WAV file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(frames)
    return path


def generate_lofi_chill_track(output_path: Path) -> Path:
    """
    Generate a 12.0s seamless loop of relaxing Lo-Fi acoustic pad chords.
    Progression (3.0s per bar):
      Bar 1: Cmaj7 (C3=130.81, E3=164.81, G3=196.00, B3=246.94)
      Bar 2: Am7   (A2=110.00, C3=130.81, E3=164.81, G3=196.00)
      Bar 3: Dm7   (D3=146.83, F3=174.61, A3=220.00, C4=261.63)
      Bar 4: G7    (G2=98.00,  D3=146.83, F3=174.61, B3=246.94)
    """
    sample_rate = 44100
    duration = 12.0
    total_samples = int(sample_rate * duration)
    frames = bytearray()

    chords = [
        [130.81, 164.81, 196.00, 246.94],  # Cmaj7
        [110.00, 130.81, 164.81, 196.00],  # Am7
        [146.83, 174.61, 220.00, 261.63],  # Dm7
        [98.00,  146.83, 174.61, 246.94],  # G7
    ]
    bar_dur = 3.0

    for i in range(total_samples):
        t = i / sample_rate
        bar_idx = min(3, int(t / bar_dur))
        t_bar = t % bar_dur
        notes = chords[bar_idx]

        # Gentle envelope with soft swell per chord (attack 0.15s, slow decay)
        chord_env = min(1.0, t_bar / 0.18) * math.exp(-0.45 * t_bar)

        # Synthesize notes with soft harmonics
        sig_l = 0.0
        sig_r = 0.0
        for n_idx, freq in enumerate(notes):
            # Base tone + warm overtone
            tone = (
                0.32 * math.sin(2 * math.pi * freq * t)
                + 0.14 * math.sin(4 * math.pi * freq * t)
                + 0.06 * math.sin(6 * math.pi * freq * t)
            )
            # Gentle stereo panning spread across chord notes
            pan = (n_idx - 1.5) / 3.0  # -0.5 to +0.5
            sig_l += tone * (0.5 - pan * 0.3)
            sig_r += tone * (0.5 + pan * 0.3)

        # Subtle sub-bass grounding
        bass_freq = notes[0] / 2.0
        bass_tone = 0.28 * math.sin(2 * math.pi * bass_freq * t)
        sig_l += bass_tone
        sig_r += bass_tone

        # Subtle vinyl crackle / tape flutter LFO
        flutter = 1.0 + 0.04 * math.sin(2 * math.pi * 3.2 * t)
        sig_l *= chord_env * flutter
        sig_r *= chord_env * flutter

        # Seamless loop boundary crossfade (0.08s at start/end)
        loop_fade = 1.0
        if t < 0.08:
            loop_fade = t / 0.08
        elif t > duration - 0.08:
            loop_fade = (duration - t) / 0.08

        sig_l *= loop_fade * 0.75
        sig_r *= loop_fade * 0.75

        # Pack to 16-bit signed integer
        val_l = int(max(-32767, min(32767, sig_l * 32767)))
        val_r = int(max(-32767, min(32767, sig_r * 32767)))
        frames.extend(struct.pack("<hh", val_l, val_r))

    return _write_pcm_wave(output_path, frames, sample_rate, 2)


def generate_comedy_quirky_track(output_path: Path) -> Path:
    """
    Generate an 8.0s seamless loop of playful, comedic marimba/pizzicato bounce.
    BPM 120 (0.5s per beat, 16 beats = 8.0s).
    """
    sample_rate = 44100
    duration = 8.0
    total_samples = int(sample_rate * duration)
    frames = bytearray()

    # Comedic melodic pattern (16 eighth notes)
    # C4, E4, G4, Bb4, A4, G4, E4, C4, D4, F4, A4, G4, E4, D4, C4, G3
    melody = [
        261.63, 329.63, 392.00, 466.16,
        440.00, 392.00, 329.63, 261.63,
        293.66, 349.23, 440.00, 392.00,
        329.63, 293.66, 261.63, 196.00,
    ]
    step_dur = 0.5  # 120 bpm quarter notes

    for i in range(total_samples):
        t = i / sample_rate
        step_idx = min(len(melody) - 1, int(t / step_dur))
        t_note = t % step_dur
        freq = melody[step_idx]

        # Sharp percussive woodblock / marimba envelope
        note_env = math.exp(-18.0 * t_note)

        # Marimba tone: fundamental + bright upper harmonic
        sig = (
            0.55 * math.sin(2 * math.pi * freq * t)
            + 0.25 * math.sin(2 * math.pi * freq * 2.756 * t)
            + 0.12 * math.sin(2 * math.pi * freq * 4.0 * t)
        ) * note_env

        # Playful bass bounce on odd beats (every 1.0s)
        t_beat = t % 1.0
        bass_env = math.exp(-12.0 * t_beat)
        bass_freq = 130.81 if (step_idx % 4 < 2) else 98.00
        bass_sig = 0.40 * math.sin(2 * math.pi * bass_freq * t) * bass_env

        total_sig = (sig * 0.7 + bass_sig * 0.3)

        # Seamless loop boundary crossfade
        loop_fade = 1.0
        if t < 0.05:
            loop_fade = t / 0.05
        elif t > duration - 0.05:
            loop_fade = (duration - t) / 0.05

        val = int(max(-32767, min(32767, total_sig * loop_fade * 0.72 * 32767)))
        frames.extend(struct.pack("<hh", val, val))

    return _write_pcm_wave(output_path, frames, sample_rate, 2)


def generate_suspense_tension_track(output_path: Path) -> Path:
    """
    Generate a 10.0s seamless loop of deep cinematic dramatic suspense drone.
    Root: D2 (73.42 Hz) + beating harmonic (73.92 Hz) + eerie dissonance (A2/D#3).
    """
    sample_rate = 44100
    duration = 10.0
    total_samples = int(sample_rate * duration)
    frames = bytearray()

    for i in range(total_samples):
        t = i / sample_rate

        # Low throbbing binaural beat (0.5 Hz beat frequency)
        root1 = math.sin(2 * math.pi * 73.42 * t)
        root2 = math.sin(2 * math.pi * 73.92 * t)
        sub = 0.5 * math.sin(2 * math.pi * 36.71 * t)

        # Slow undulating dissonant harmonic (fades in and out via 0.2Hz LFO)
        diss_lfo = 0.5 * (1.0 + math.sin(2 * math.pi * 0.2 * t - math.pi / 2))
        diss_tone = 0.35 * math.sin(2 * math.pi * 155.56 * t) * diss_lfo

        # High tension eerie overtone (587.33 Hz)
        eerie = 0.15 * math.sin(2 * math.pi * 587.33 * t) * (0.6 + 0.4 * math.sin(2 * math.pi * 0.3 * t))

        sig_l = (0.35 * root1 + 0.25 * sub + 0.20 * diss_tone + 0.10 * eerie)
        sig_r = (0.35 * root2 + 0.25 * sub + 0.15 * diss_tone + 0.15 * eerie)

        # Seamless loop boundary crossfade
        loop_fade = 1.0
        if t < 0.08:
            loop_fade = t / 0.08
        elif t > duration - 0.08:
            loop_fade = (duration - t) / 0.08

        sig_l *= loop_fade * 0.78
        sig_r *= loop_fade * 0.78

        val_l = int(max(-32767, min(32767, sig_l * 32767)))
        val_r = int(max(-32767, min(32767, sig_r * 32767)))
        frames.extend(struct.pack("<hh", val_l, val_r))

    return _write_pcm_wave(output_path, frames, sample_rate, 2)


def ensure_default_music_tracks() -> None:
    """Verify that all default procedural BGM tracks exist; generate any that are missing."""
    music_dir = get_music_dir()
    generators = {
        "lofi_chill": generate_lofi_chill_track,
        "comedy_quirky": generate_comedy_quirky_track,
        "suspense_tension": generate_suspense_tension_track,
    }

    for preset in PRESET_CATALOGUE:
        track_id = preset["id"]
        file_path = music_dir / preset["filename"]
        if not file_path.exists() or file_path.stat().st_size == 0:
            gen_func = generators.get(track_id)
            if gen_func:
                logger.info(f"Generating default BGM track: '{track_id}' -> {file_path}")
                try:
                    gen_func(file_path)
                except Exception as exc:
                    logger.error(f"Failed to generate BGM track '{track_id}': {exc}")


def list_music_tracks(api_prefix: str = "/api/music") -> list[dict[str, Any]]:
    """
    Return all available BGM tracks (built-in presets and user-uploaded files).
    Automatically initializes preset audio files if not present.
    """
    ensure_default_music_tracks()
    music_dir = get_music_dir()

    results: list[dict[str, Any]] = []

    # 1. Add preset tracks first
    preset_ids = set()
    for preset in PRESET_CATALOGUE:
        track_id = preset["id"]
        preset_ids.add(track_id)
        file_path = music_dir / preset["filename"]
        exists = file_path.exists()
        results.append({
            "id": track_id,
            "name": preset["name"],
            "category": preset["category"],
            "duration": preset["duration"],
            "filename": preset["filename"],
            "file_url": f"{api_prefix}/{track_id}/stream",
            "description": preset["description"],
            "is_custom": False,
            "exists": exists,
        })

    # 2. Add custom uploaded audio files in music_dir
    supported_exts = {".mp3", ".wav", ".m4a", ".aac", ".ogg"}
    for f in music_dir.iterdir():
        if f.is_file() and f.suffix.lower() in supported_exts:
            if f.name in [p["filename"] for p in PRESET_CATALOGUE]:
                continue
            custom_id = f.stem
            clean_name = re.sub(r"[_\-]+", " ", f.stem).title()
            results.append({
                "id": custom_id,
                "name": clean_name,
                "category": "Custom Upload",
                "duration": 0.0,
                "filename": f.name,
                "file_url": f"{api_prefix}/{custom_id}/stream",
                "description": f"Custom track: {f.name}",
                "is_custom": True,
                "exists": True,
            })

    return results


def get_music_track_path(track_id: str) -> Path | None:
    """Resolve the local filesystem Path of a track given its ID or filename."""
    ensure_default_music_tracks()
    music_dir = get_music_dir()

    # 1. Match by preset catalog ID
    for preset in PRESET_CATALOGUE:
        if preset["id"] == track_id:
            p = music_dir / preset["filename"]
            if p.exists():
                return p

    # 2. Match direct filename
    direct = music_dir / track_id
    if direct.exists() and direct.is_file():
        return direct

    # 3. Match stem for custom uploads (e.g., track_id without extension)
    for f in music_dir.iterdir():
        if f.is_file() and f.stem == track_id:
            return f

    return None


def save_custom_music_track(
    filename: str,
    content: bytes,
    display_name: str | None = None,
) -> dict[str, Any]:
    """
    Save user-uploaded audio file to the music directory.
    Validates audio file extension and returns metadata.
    """
    music_dir = get_music_dir()
    clean_stem = re.sub(r"[^a-zA-Z0-9_\-]", "_", Path(filename).stem)[:48].strip("_")
    ext = Path(filename).suffix.lower()
    if ext not in {".mp3", ".wav", ".m4a", ".aac", ".ogg"}:
        raise ValueError(f"Format audio '{ext}' tidak didukung. Gunakan MP3, WAV, M4A, atau AAC.")

    dest_filename = f"custom_{clean_stem}{ext}"
    dest_path = music_dir / dest_filename
    dest_path.write_bytes(content)

    track_id = dest_path.stem
    name = display_name.strip() if display_name and display_name.strip() else clean_stem.replace("_", " ").title()

    return {
        "id": track_id,
        "name": name,
        "category": "Custom Upload",
        "duration": 0.0,
        "filename": dest_filename,
        "file_url": f"/api/music/{track_id}/stream",
        "description": f"Custom audio: {dest_filename}",
        "is_custom": True,
        "exists": True,
    }
