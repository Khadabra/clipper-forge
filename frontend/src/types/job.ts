/**
 * types/job.ts — TypeScript types for Background Jobs & Job Queue.
 */

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  project_id: string;
  job_type: string;
  status: JobStatus;
  progress: number;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface JobCreateRequest {
  project_id: string;
  job_type: string;
  params?: Record<string, unknown>;
}

export interface JobCancelResponse {
  id: string;
  status: string;
  message: string;
}
