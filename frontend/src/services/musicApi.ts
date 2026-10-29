/**
 * services/musicApi.ts — API client for Background Music (BGM) Library & Uploads.
 */
import type { MusicTrack } from '../types/clip';

const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';

export async function fetchMusicTracks(): Promise<MusicTrack[]> {
  const resp = await fetch(`${API_BASE}/music`);
  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal memuat pustaka musik latar.');
  }
  const data = await resp.json();
  return data.tracks || [];
}

export function getMusicStreamUrl(trackId: string): string {
  return `${API_BASE}/music/${encodeURIComponent(trackId)}/stream`;
}

export async function uploadMusicTrack(file: File, displayName?: string): Promise<MusicTrack> {
  const formData = new FormData();
  formData.append('file', file);
  if (displayName) {
    formData.append('name', displayName);
  }

  const resp = await fetch(`${API_BASE}/music/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal mengunggah file musik.');
  }

  return resp.json();
}
