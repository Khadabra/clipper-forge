/**
 * services/clipsApi.ts — API client for AI-curated clip candidates and rendering exports.
 */
import type {
  ClipCandidate,
  ClipCandidateUpdate,
  ClipListResponse,
  ClipRenderRequest,
  ClipRenderResponse,
  ClipSubtitleSegment,
  FindClipsResponse,
} from '../types/clip';

const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';
const ROOT_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export async function triggerFindClips(projectId: string): Promise<FindClipsResponse> {
  const resp = await fetch(`${API_BASE}/projects/${projectId}/find-clips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal memulai pencarian klip viral.');
  }

  return resp.json();
}

export async function fetchClips(projectId: string): Promise<ClipListResponse> {
  const resp = await fetch(`${API_BASE}/projects/${projectId}/clips`);
  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || `Gagal memuat kandidat klip: ${resp.status}`);
  }
  return resp.json();
}

export async function updateClip(
  clipId: string,
  payload: ClipCandidateUpdate
): Promise<ClipCandidate> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal memperbarui klip.');
  }

  return resp.json();
}

export async function deleteClip(clipId: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}`, {
    method: 'DELETE',
  });

  if (!resp.ok && resp.status !== 404) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal menghapus klip.');
  }
}

export async function triggerRenderClip(
  clipId: string,
  payload: ClipRenderRequest = {}
): Promise<ClipRenderResponse> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal memulai pekerjaan render video vertikal.');
  }

  return resp.json();
}

export function getRenderedClipStreamUrl(projectId: string, clipId: string): string {
  return `${ROOT_BASE}/storage/projects/${projectId}/exports/clip_${clipId}.mp4`;
}

export function getDownloadClipUrl(clipId: string): string {
  return `${API_BASE}/clips/${clipId}/download`;
}

export async function downloadRenderedClip(
  clipId: string,
  filename?: string
): Promise<void> {
  const url = getDownloadClipUrl(clipId);
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || 'Gagal mengunduh file video hasil render.');
  }

  const blob = await resp.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename || `clip_${clipId.slice(0, 8)}_9-16.mp4`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
}

export async function fetchClipTranscript(clipId: string): Promise<ClipSubtitleSegment[]> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}/transcript`);
  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal memuat transkrip klip.');
  }
  return resp.json();
}

export async function updateClipTranscript(
  clipId: string,
  segments: ClipSubtitleSegment[]
): Promise<ClipCandidate> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}/transcript`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(segments),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal menyimpan transkrip kustom.');
  }

  return resp.json();
}

