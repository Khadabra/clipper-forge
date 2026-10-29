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
  SocialCopyResponse,
  TitleAnalysisResponse,
  TitleRecommendationsResponse,
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

export interface ManualClipCreateRequest {
  title?: string;
  start_time?: number;
  end_time?: number;
  aspect_ratio?: string;
  subtitle_style?: string;
  crop_mode?: string;
  auto_zoom?: string;
}

export async function createManualClip(
  projectId: string,
  payload?: ManualClipCreateRequest
): Promise<ClipCandidate> {
  const resp = await fetch(`${API_BASE}/projects/${projectId}/clips/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal membuat klip manual.');
  }

  return resp.json();
}


export async function fetchAllClips(renderStatus?: string): Promise<ClipCandidate[]> {
  const url = renderStatus
    ? `${API_BASE}/clips?render_status=${encodeURIComponent(renderStatus)}`
    : `${API_BASE}/clips`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || `Gagal memuat semua klip: ${resp.status}`);
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

export function getClipCoverUrl(clipId: string): string {
  return `${API_BASE}/clips/${clipId}/cover`;
}

export async function generateAndDownloadCover(
  clipId: string,
  filename?: string
): Promise<void> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}/generate-cover`, {
    method: 'POST',
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal menghasilkan cover JPG dari video.');
  }

  const blob = await resp.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename || `cover_${clipId.slice(0, 8)}_1080x1920.jpg`;
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

export async function analyzeClipTitle(
  clipId: string,
  title?: string
): Promise<TitleAnalysisResponse> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}/analyze-title`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal menganalisis skor SEO judul.');
  }

  return resp.json();
}

export async function getRecommendedTitles(
  clipId: string
): Promise<TitleRecommendationsResponse> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}/recommend-titles`, {
    method: 'POST',
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal mendapatkan rekomendasi judul AI.');
  }

  return resp.json();
}

export async function generateClipSocialCopy(
  clipId: string,
  platform: string = 'all',
  customTopic?: string
): Promise<SocialCopyResponse> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}/generate-social-copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, custom_topic: customTopic }),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal menghasilkan copy media sosial AI.');
  }

  return resp.json();
}

export async function getClipSocialCopy(
  clipId: string
): Promise<SocialCopyResponse> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}/social-copy`);
  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal memuat copy media sosial.');
  }

  return resp.json();
}

export function getExportKitUrl(clipId: string): string {
  return `${API_BASE}/clips/${clipId}/export-kit`;
}

export async function downloadExportKit(
  clipId: string,
  filename?: string
): Promise<void> {
  const url = getExportKitUrl(clipId);
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || 'Gagal mengunduh paket publishing kit.');
  }

  const blob = await resp.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename || `ClipperForge_Kit_${clipId.slice(0, 8)}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
}

export async function analyzeTracking(
  clipId: string,
  payload?: { mode?: string; crop_x_pct?: number }
): Promise<{
  clip_id: string;
  mode: string;
  confidence: number;
  fallback_reason: string;
  detected_speakers: any[];
  shot_cuts: number[];
  crop_expr: string;
  split_params?: any;
}> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}/analyze-tracking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || 'Gagal menganalisis active tracking.');
  }
  return resp.json();
}

export async function previewTimeline(
  clipId: string
): Promise<any> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}/preview-timeline`, {
    method: 'POST',
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || 'Gagal memuat pratinjau timeline.');
  }
  return resp.json();
}

export async function fetchCoverCandidates(
  clipId: string
): Promise<any> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}/cover-candidates`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || 'Gagal memuat kandidat cover thumbnail.');
  }
  return resp.json();
}

export async function saveClipCover(
  clipId: string,
  payload: {
    timestamp: number;
    headline_text?: string;
    style_preset?: string;
    aspect_ratio?: string;
    position_y_pct?: number;
  }
): Promise<{ clip_id: string; cover_file_path: string; message: string }> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}/save-cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || 'Gagal menyimpan custom cover thumbnail.');
  }
  return resp.json();
}

export async function fetchQualityReport(
  clipId: string
): Promise<any> {
  const resp = await fetch(`${API_BASE}/clips/${clipId}/quality-report`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || 'Gagal memuat laporan quality gate.');
  }
  return resp.json();
}



