/**
 * services/transcriptsApi.ts — API client for transcription jobs and subtitle downloads.
 */
import type {
  TranscribeRequest,
  TranscribeResponse,
  TranscriptListResponse,
} from '../types/transcript';

const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';

export async function triggerTranscription(
  projectId: string,
  req: TranscribeRequest = { model_size: 'base' }
): Promise<TranscribeResponse> {
  const resp = await fetch(`${API_BASE}/projects/${projectId}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal memulai transkripsi.');
  }

  return resp.json();
}

export async function fetchTranscript(projectId: string): Promise<TranscriptListResponse> {
  const resp = await fetch(`${API_BASE}/projects/${projectId}/transcript`);
  if (!resp.ok) {
    throw new Error(`Gagal memuat transkrip: ${resp.status}`);
  }
  return resp.json();
}

export function getExportUrl(projectId: string, format: 'srt' | 'vtt' | 'txt'): string {
  return `${API_BASE}/projects/${projectId}/transcript/export?format=${format}`;
}

export async function downloadTranscript(
  projectId: string,
  format: 'srt' | 'vtt' | 'txt',
  filename?: string
): Promise<void> {
  const url = getExportUrl(projectId, format);
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || 'Gagal mengunduh file transkrip.');
  }

  const blob = await resp.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename || `transcript_${projectId}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
}
