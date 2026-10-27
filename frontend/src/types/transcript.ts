/**
 * types/transcript.ts — TypeScript types for Transcript and Subtitles.
 */

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export interface TranscriptSegment {
  id: string;
  project_id: string;
  segment_index: number;
  start_time: number;
  end_time: number;
  text: string;
  words?: WordTimestamp[];
  created_at: string;
}

export interface TranscribeRequest {
  model_size?: 'base' | 'small';
  language?: string;
}

export interface TranscribeResponse {
  project_id: string;
  job_id: string;
  message: string;
  model_size: string;
}

export interface TranscriptListResponse {
  project_id: string;
  total_segments: number;
  segments: TranscriptSegment[];
}
