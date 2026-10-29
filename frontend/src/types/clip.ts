/**
 * types/clip.ts — TypeScript types for AI Clip Finder & Curated Shorts Hub.
 */

export type ClipStatus = 'suggested' | 'approved' | 'rejected';
export type AspectRatio = '9:16' | '1:1' | '4:5' | '16:9';
export type SubtitleStyle =
  | 'hormozi'
  | 'condensed_clean'
  | 'boxed_vox'
  | 'cyber_neon'
  | 'word_highlight'
  | 'none';
export type CropMode =
  | 'blur_fill'
  | 'center_crop'
  | 'framed_headline'
  | 'speaker_track'
  | 'streamer_split'
  | 'reframe'
  | 'single_speaker'
  | 'active_speaker'
  | 'split_screen'
  | 'manual_reframe';
export type AutoZoom = 'none' | 'subtle' | 'snap_hook' | 'jump_cut';
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
  cover_file_path?: string | null;
  aspect_ratio: AspectRatio;
  crop_x_pct?: number;
  remove_silence?: boolean;
  auto_emoji?: boolean;
  subtitle_style: SubtitleStyle;
  crop_mode: CropMode;
  auto_zoom: AutoZoom;
  intro_hook_banner?: boolean;
  show_hook_banner?: boolean;
  framing_offset_pct?: number;
  enable_sfx?: boolean;
  bgm_track_id?: string | null;
  bgm_volume?: number;
  soundboard_cues_json?: string | null;
  custom_transcript_json?: string | null;
  social_copy_json?: string | null;
  tracking_mode?: string;
  tracking_confidence?: number;
  tracking_fallback_reason?: string | null;
  quality_report_json?: string | null;
  subscores_json?: string | null;
  starts_mid_sentence?: boolean;
  ends_abruptly?: boolean;
  render_status: RenderStatus;
  created_at: string;
}

export interface ClipCandidateUpdate {
  title?: string;
  start_time?: number;
  end_time?: number;
  status?: ClipStatus;
  aspect_ratio?: AspectRatio;
  crop_x_pct?: number;
  remove_silence?: boolean;
  auto_emoji?: boolean;
  subtitle_style?: SubtitleStyle;
  crop_mode?: CropMode;
  auto_zoom?: AutoZoom;
  intro_hook_banner?: boolean;
  show_hook_banner?: boolean;
  framing_offset_pct?: number;
  enable_sfx?: boolean;
  bgm_track_id?: string | null;
  bgm_volume?: number;
  soundboard_cues_json?: string | null;
  custom_transcript_json?: string | null;
  social_copy_json?: string | null;
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

export interface SoundboardCue {
  id?: string;
  sound_id: string;
  timestamp: number;
  volume?: number;
  segment_id?: string;
}

export interface SoundboardSound {
  id: string;
  name: string;
  category: string;
  duration: number;
  icon: string;
  filename: string;
  file_url: string;
  description?: string;
  is_custom?: boolean;
  exists?: boolean;
}

export interface ClipRenderRequest {
  aspect_ratio?: AspectRatio;
  crop_x_pct?: number;
  remove_silence?: boolean;
  auto_emoji?: boolean;
  subtitle_style?: SubtitleStyle;
  crop_mode?: CropMode;
  auto_zoom?: AutoZoom;
  intro_hook_banner?: boolean;
  show_hook_banner?: boolean;
  enable_sfx?: boolean;
  framing_offset_pct?: number;
  bgm_track_id?: string | null;
  bgm_volume?: number;
  soundboard_cues?: SoundboardCue[];
  soundboard_cues_json?: string | null;
}

export interface MusicTrack {
  id: string;
  name: string;
  category: string;
  duration: number;
  filename: string;
  file_url: string;
  description?: string;
  is_custom?: boolean;
  exists?: boolean;
}

export interface ClipRenderResponse {
  clip_id: string;
  job_id: string;
  message: string;
}

export interface SEOCheckItem {
  id: string;
  label: string;
  status: 'good' | 'warning' | 'critical';
  score: number;
  max_score: number;
  message: string;
  tip: string;
}

export interface TitleAnalysisResponse {
  title: string;
  score: number;
  rating: 'good' | 'fair' | 'poor';
  char_count: number;
  word_count: number;
  matched_power_words: string[];
  checklist: SEOCheckItem[];
  suggestions: string[];
}

export interface TitleRecommendationItem {
  title: string;
  score: number;
  rating: 'good' | 'fair' | 'poor';
  matched_power_words: string[];
}

export interface TitleRecommendationsResponse {
  clip_id: string;
  recommendations: TitleRecommendationItem[];
}

export type SocialCopyPlatform = 'tiktok' | 'shorts' | 'reels';

export interface SocialCopyItem {
  platform: SocialCopyPlatform;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  cta: string;
  full_formatted_text: string;
}

export interface SocialCopyResponse {
  clip_id: string;
  copies: Record<string, SocialCopyItem>;
}

export interface QualityIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  timestamp_range?: [number, number];
}

export interface RenderQualityReport {
  status: 'pass' | 'warning' | 'fail' | 'pending';
  checked_at?: string;
  video_path?: string;
  metrics: {
    duration?: number;
    width?: number;
    height?: number;
    codec_name?: string;
    audio_codec?: string;
    audio_mean_volume_db?: number;
    audio_max_volume_db?: number;
    file_size_mb?: number;
    black_segments_count?: number;
    frozen_segments_count?: number;
  };
  issues: QualityIssue[];
  message?: string;
}

export interface CoverFrameCandidate {
  timestamp: number;
  sharpness: number;
  has_face: boolean;
  face_count: number;
  data_url: string;
}

export interface HeadlineSuggestion {
  headline: string;
  category: string;
}

export interface CoverCandidatesResponse {
  clip_id: string;
  candidates: CoverFrameCandidate[];
  headline_suggestions: HeadlineSuggestion[];
}

export interface TimelineIntervalMapping {
  original_start: number;
  original_end: number;
  rendered_start: number;
  rendered_end: number;
  duration: number;
}

export interface TimelinePreviewResponse {
  clip_id: string;
  original_duration: number;
  rendered_duration: number;
  silence_intervals_removed: Array<{ start: number; end: number; duration: number }>;
  timeline_mapping: TimelineIntervalMapping[];
  remapped_segments: any[];
}


