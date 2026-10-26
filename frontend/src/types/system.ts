export interface BinaryCheck {
  available: boolean;
  version: string | null;
  path?: string | null;
  error?: string | null;
}

export interface DiskSpaceInfo {
  total_gb: number;
  used_gb: number;
  free_gb: number;
  free_percent: number;
  path: string;
}

export interface PythonInfo {
  version: string;
  compiler?: string;
  system?: string;
  release?: string;
}

export interface SystemCheckResponse {
  status: 'ready' | 'degraded';
  ffmpeg: BinaryCheck;
  ffprobe: BinaryCheck;
  python: PythonInfo;
  disk_space: DiskSpaceInfo;
  guidance?: string | null;
}

export interface HealthResponse {
  status: string;
  app: string;
  version: string;
}
