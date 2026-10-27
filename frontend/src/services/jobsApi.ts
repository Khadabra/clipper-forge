/**
 * services/jobsApi.ts — API client for background jobs and real-time SSE subscriptions.
 */
import type { Job, JobCancelResponse, JobCreateRequest } from '../types/job';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export async function createJob(req: JobCreateRequest): Promise<Job> {
  const resp = await fetch(`${API_BASE}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Gagal membuat job baru.');
  }

  return resp.json();
}

export async function fetchJob(jobId: string): Promise<Job> {
  const resp = await fetch(`${API_BASE}/api/jobs/${jobId}`);
  if (!resp.ok) {
    throw new Error(`Job '${jobId}' tidak ditemukan.`);
  }
  return resp.json();
}

export async function cancelJob(jobId: string): Promise<JobCancelResponse> {
  const resp = await fetch(`${API_BASE}/api/jobs/${jobId}/cancel`, {
    method: 'POST',
  });
  if (!resp.ok) {
    throw new Error(`Gagal membatalkan job '${jobId}'.`);
  }
  return resp.json();
}

export async function fetchProjectJobs(projectId: string): Promise<Job[]> {
  const resp = await fetch(`${API_BASE}/api/projects/${projectId}/jobs`);
  if (!resp.ok) {
    throw new Error('Gagal mengambil daftar job proyek.');
  }
  return resp.json();
}

/**
 * Subscribe to real-time job updates via Server-Sent Events (SSE).
 * Returns a teardown function to unsubscribe.
 */
export function subscribeJobEvents(
  jobId: string,
  onUpdate: (job: Job) => void,
  onError?: (err: unknown) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}/api/jobs/${jobId}/events`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onUpdate(data);

      if (['completed', 'failed', 'cancelled'].includes(data.status)) {
        eventSource.close();
      }
    } catch (e) {
      onError?.(e);
    }
  };

  eventSource.onerror = (err) => {
    onError?.(err);
    eventSource.close();
  };

  return () => {
    eventSource.close();
  };
}
