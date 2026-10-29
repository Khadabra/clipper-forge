/**
 * services/soundboardApi.ts — API client for Meme Soundboard & Reaction SFX Engine.
 */
import type { SoundboardSound } from '../types/clip';

const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';

export async function fetchSoundboardSounds(): Promise<SoundboardSound[]> {
  const resp = await fetch(`${API_BASE}/soundboard`);
  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal memuat pustaka Meme Soundboard.');
  }
  const data = await resp.json();
  if (Array.isArray(data)) {
    return data;
  }
  return data.sounds || [];
}

export function getSoundStreamUrl(soundId: string): string {
  return `${API_BASE}/soundboard/${encodeURIComponent(soundId)}/stream`;
}

export async function uploadSound(file: File, displayName?: string): Promise<SoundboardSound> {
  const formData = new FormData();
  formData.append('file', file);
  if (displayName) {
    formData.append('name', displayName);
  }

  const resp = await fetch(`${API_BASE}/soundboard/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal mengunggah file SFX.');
  }

  return resp.json();
}
