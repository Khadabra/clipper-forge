/**
 * services/projectsApi.ts — API client for project endpoints.
 * Uses XMLHttpRequest for real upload progress tracking.
 */
import type { Project, ProjectListItem, UploadResponse } from '../types/project';

const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';

// ── List all projects ─────────────────────────────────────────────────────────

export async function fetchProjects(): Promise<ProjectListItem[]> {
  const resp = await fetch(`${API_BASE}/projects`);
  if (!resp.ok) throw new Error(`Failed to fetch projects: ${resp.status}`);
  return resp.json();
}

// ── Get single project ────────────────────────────────────────────────────────

export async function fetchProject(id: string): Promise<Project> {
  const resp = await fetch(`${API_BASE}/projects/${id}`);
  if (!resp.ok) throw new Error(`Project not found: ${resp.status}`);
  return resp.json();
}

// ── Upload a video file ───────────────────────────────────────────────────────

export function uploadProjectFile(
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Invalid JSON response from server'));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err?.detail?.message || err?.detail || `Upload failed: ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

    if (signal) {
      signal.addEventListener('abort', () => xhr.abort());
    }

    xhr.open('POST', `${API_BASE}/projects/upload`);
    xhr.send(formData);
  });
}

// ── Ingest video from YouTube URL ──────────────────────────────────────────

export async function ingestYouTubeVideo(url: string): Promise<import('../types/project').YouTubeIngestResponse> {
  const resp = await fetch(`${API_BASE}/projects/youtube`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `Gagal memproses YouTube URL: ${resp.status}`);
  }

  return resp.json();
}

// ── Delete a project ──────────────────────────────────────────────────────────

export async function deleteProject(id: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/projects/${id}`, { method: 'DELETE' });
  if (!resp.ok && resp.status !== 204) {
    throw new Error(`Failed to delete project: ${resp.status}`);
  }
}


