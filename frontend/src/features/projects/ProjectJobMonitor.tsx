/**
 * features/projects/ProjectJobMonitor.tsx
 * Real-time Job Queue Monitor for a Project with SSE streaming.
 */
import type React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Loader2, X, Clock } from 'lucide-react';
import type { Job } from '../../types/job';
import {
  createJob,
  fetchProjectJobs,
  cancelJob,
  subscribeJobEvents,
} from '../../services/jobsApi';

interface Props {
  projectId: string;
}

export const ProjectJobMonitor: React.FC<Props> = ({ projectId }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const activeUnsubs = useRef<Record<string, () => void>>({});

  // ── Load jobs list ─────────────────────────────────────────────────────────
  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchProjectJobs(projectId);
      setJobs(data);
    } catch {
      // Graceful fallback
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadJobs();
    return () => {
      // Cleanup all SSE listeners on unmount
      Object.values(activeUnsubs.current).forEach((unsub) => unsub());
      activeUnsubs.current = {};
    };
  }, [loadJobs]);

  // ── Listen to active jobs via SSE ──────────────────────────────────────────
  useEffect(() => {
    jobs.forEach((job) => {
      const isTerminal = ['completed', 'failed', 'cancelled'].includes(job.status);
      if (!isTerminal && !activeUnsubs.current[job.id]) {
        activeUnsubs.current[job.id] = subscribeJobEvents(
          job.id,
          (updated) => {
            setJobs((prev) =>
              prev.map((j) => (j.id === updated.id ? { ...j, ...updated } : j))
            );
            if (['completed', 'failed', 'cancelled'].includes(updated.status)) {
              delete activeUnsubs.current[job.id];
            }
          },
          () => {
            delete activeUnsubs.current[job.id];
          }
        );
      }
    });
  }, [jobs]);

  // ── Start a test background job ────────────────────────────────────────────
  const handleStartTestJob = async () => {
    setSubmitting(true);
    try {
      const newJob = await createJob({
        project_id: projectId,
        job_type: 'dummy_task',
      });
      setJobs((prev) => [newJob, ...prev]);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Gagal memulai job.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Cancel job ─────────────────────────────────────────────────────────────
  const handleCancel = async (jobId: string) => {
    try {
      await cancelJob(jobId);
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, status: 'cancelled' } : j))
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Gagal membatalkan job.');
    }
  };

  const getJobLabel = (type: string) => {
    switch (type) {
      case 'dummy_task':
        return 'Simulasi Analisis & Pemrosesan Klip';
      case 'probe':
        return 'Inspeksi Metadata FFprobe';
      case 'transcode':
        return 'Transcode Video (H.264 / AAC)';
      default:
        return type;
    }
  };

  return (
    <div
      style={{
        marginTop: 20,
        padding: 16,
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Clock size={14} color="var(--text-muted)" />
            Antrean Tugas Latar Belakang (Job Queue)
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Pantau progres tugas analisis dan rendering secara real-time via SSE.
          </div>
        </div>

        <button
          id="btn-trigger-test-job"
          className="btn btn-secondary btn-sm"
          onClick={handleStartTestJob}
          disabled={submitting}
          type="button"
        >
          {submitting ? (
            <Loader2 size={12} className="spin" />
          ) : (
            <Play size={12} fill="currentColor" />
          )}
          Uji Antrean Tugas
        </button>
      </div>

      {loading && jobs.length === 0 ? (
        <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          Memuat antrean tugas...
        </div>
      ) : jobs.length === 0 ? (
        <div
          style={{
            padding: '16px',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--text-muted)',
            border: '1px dashed var(--border-color)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          Belum ada tugas pemrosesan latar belakang untuk proyek ini.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {jobs.map((job) => (
            <div
              key={job.id}
              id={`job-item-${job.id}`}
              style={{
                padding: '10px 12px',
                background: 'var(--bg-card-subtle, #141416)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {getJobLabel(job.job_type)}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    #{job.id.slice(0, 8)}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {job.status === 'pending' && (
                    <span className="status-pill planned">Menunggu</span>
                  )}
                  {job.status === 'processing' && (
                    <span
                      className="status-pill active"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        color: 'var(--accent-amber, #f59e0b)',
                      }}
                    >
                      <Loader2 size={10} className="spin" />
                      Memproses ({job.progress}%)
                    </span>
                  )}
                  {job.status === 'completed' && (
                    <span className="status-pill ready">✓ Selesai</span>
                  )}
                  {job.status === 'cancelled' && (
                    <span className="status-pill planned">Dibatalkan</span>
                  )}
                  {job.status === 'failed' && (
                    <span
                      className="status-pill"
                      style={{
                        color: 'var(--accent-red, #ef4444)',
                        borderColor: 'rgba(239, 68, 68, 0.3)',
                      }}
                    >
                      ✕ Gagal
                    </span>
                  )}

                  {['pending', 'processing'].includes(job.status) && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleCancel(job.id)}
                      style={{ padding: '2px 6px', height: 'auto' }}
                      title="Batalkan tugas"
                      type="button"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {job.status === 'processing' && (
                <div
                  className="upload-progress-track"
                  style={{ height: 4, marginTop: 4 }}
                >
                  <div
                    className="upload-progress-fill"
                    style={{ width: `${job.progress}%` }}
                    role="progressbar"
                    aria-valuenow={job.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
              )}

              {job.error_message && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--accent-red, #ef4444)',
                    marginTop: 4,
                  }}
                >
                  Error: {job.error_message}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
