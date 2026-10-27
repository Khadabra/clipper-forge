/**
 * types/project.ts — TypeScript type definitions for Project entities.
 */

export type ProjectStatus =
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'downloading'
  | 'transcribing'
  | 'transcribed'
  | 'clips_ready';

export interface Project {
  id: string;
  title: string;
  original_filename: string;
  file_path: string;
  source_url?: string | null;
  thumbnail_url?: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  audio_channels: number | null;
  file_size_bytes: number;
  status: ProjectStatus;
  created_at: string; // ISO datetime string
}

export interface ProjectListItem {
  id: string;
  title: string;
  original_filename: string;
  source_url?: string | null;
  thumbnail_url?: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  file_size_bytes: number;
  status: ProjectStatus;
  created_at: string;
}

export interface UploadResponse {
  project: Project;
  message: string;
}

export interface YouTubeIngestResponse {
  project_id: string;
  job_id: string;
  message: string;
  project: Project;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === 0) return '--:--';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(bytes / 1024).toFixed(1)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function getResolutionLabel(height: number | null): string {
  if (!height) return '--';
  const labels: [number, string][] = [
    [2160, '4K UHD'],
    [1440, '1440p QHD'],
    [1080, '1080p FHD'],
    [720, '720p HD'],
    [480, '480p SD'],
  ];
  for (const [h, label] of labels) {
    if (height >= h) return label;
  }
  return `${height}p`;
}

export function getAspectRatio(
  width: number | null,
  height: number | null
): string {
  if (!width || !height) return '--';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

export function formatFps(fps: number | null): string {
  if (!fps) return '--';
  return `${fps % 1 === 0 ? fps.toFixed(0) : fps.toFixed(2)} fps`;
}

export function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'baru saja';
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} jam lalu`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} hari lalu`;
}
