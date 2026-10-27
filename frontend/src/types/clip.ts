/**
 * types/clip.ts — TypeScript types for AI Clip Finder & Curated Shorts Hub.
 */

export type ClipStatus = 'suggested' | 'approved' | 'rejected';
export type AspectRatio = '9:16' | '1:1' | '16:9';
export type SubtitleStyle =
  | 'hormozi'
  | 'condensed_clean'
  | 'boxed_vox'
  | 'cyber_neon'
  | 'word_highlight'
  | 'none';
export type CropMode = 'blur_fill' | 'center_crop' | 'framed_headline' | 'speaker_track';
export type AutoZoom = 'none' | 'subtle' | 'snap_hook';
export type RenderStatus = 'idle' | 'rendering' | 'completed' | 'failed';

export interface ClipSubtitleSegment {
  id?: string;
  segment_index?: number;
  start_time: number;
  end_time: number;
  text: string;
  speaker_label?: string | null;
}

export interface ClipCandidate {
  id: string;
  project_id: string;
  title: string;
  hook: string;
  rationale: string;
  start_time: number;
  end_time: number;
  virality_score: number;
  category: string;
  status: ClipStatus;
  rendered_file_path?: string | null;
  aspect_ratio: AspectRatio;
  subtitle_style: SubtitleStyle;
  crop_mode: CropMode;
  auto_zoom: AutoZoom;
  custom_transcript_json?: string | null;
  render_status: RenderStatus;
  created_at: string;
}

export interface ClipCandidateUpdate {
  title?: string;
  start_time?: number;
  end_time?: number;
  status?: ClipStatus;
  aspect_ratio?: AspectRatio;
  subtitle_style?: SubtitleStyle;
  crop_mode?: CropMode;
  auto_zoom?: AutoZoom;
  custom_transcript_json?: string | null;
}

export interface FindClipsResponse {
  project_id: string;
  job_id: string;
  message: string;
}

export interface ClipListResponse {
  project_id: string;
  total_clips: number;
  clips: ClipCandidate[];
}

export interface ClipRenderRequest {
  aspect_ratio?: AspectRatio;
  subtitle_style?: SubtitleStyle;
  crop_mode?: CropMode;
  auto_zoom?: AutoZoom;
}

export interface ClipRenderResponse {
  clip_id: string;
  job_id: string;
  message: string;
}
