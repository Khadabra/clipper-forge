/**
 * features/projects/ProjectsPage.tsx
 * Milestone 2 — Media Ingestion hub: upload, YouTube ingestion, inspect, and manage videos.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, FolderOpen, X, AlertCircle, RotateCcw, Link as LinkIcon, Loader2 } from 'lucide-react';
import { UploadZone } from './UploadZone';
import { YouTubeIngestZone } from './YouTubeIngestZone';
import { VideoOverviewCard } from './VideoOverviewCard';
import { ProjectList } from './ProjectList';
import {
  uploadProjectFile,
  fetchProjects,
  fetchProject,
  deleteProject,
} from '../../services/projectsApi';
import { cancelJob, subscribeJobEvents } from '../../services/jobsApi';
import { fetchClips, createManualClip } from '../../services/clipsApi';
import type { Project, ProjectListItem } from '../../types/project';
import type { ClipCandidate } from '../../types/clip';
import { ClipEditorStudio } from '../clips/ClipEditorStudio';

type IngestTab = 'file' | 'youtube';

interface ProjectsPageProps {
  onOpenEditor?: (clip: ClipCandidate) => void;
}

type IngestState =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number; filename: string }
  | {
      status: 'downloading_yt';
      projectId: string;
      jobId: string;
      progress: number;
      url: string;
      title?: string;
    }
  | { status: 'success'; project: Project }
  | { status: 'error'; message: string };

export function ProjectsPage({ onOpenEditor }: ProjectsPageProps = {}) {
  const [tab, setTab] = useState<IngestTab>('file');
  const [ingestState, setIngestState] = useState<IngestState>({ status: 'idle' });
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeStudioClip, setActiveStudioClip] = useState<ClipCandidate | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const ytUnsubRef = useRef<(() => void) | null>(null);

  // ── Continue to Vertical Studio Editor (AI or Manual CapCut-style) ───────────
  const handleContinueToEditor = async (project: Project) => {
    try {
      const res = await fetchClips(project.id);
      if (res.clips && res.clips.length > 0) {
        if (onOpenEditor) {
          onOpenEditor(res.clips[0]);
        } else {
          setActiveStudioClip(res.clips[0]);
        }
        return;
      }

      // If no clip exists yet, generate an instant manual clip and open editor immediately
      const dur = project.duration || 60;
      const newClip = await createManualClip(project.id, {
        title: `${project.title || 'Klip'} (Manual)`,
        start_time: 0.0,
        end_time: Math.min(dur, 30.0),
      });
      if (onOpenEditor) {
        onOpenEditor(newClip);
      } else {
        setActiveStudioClip(newClip);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Gagal membuka studio editor.');
    }
  };

  // ── Cleanup SSE on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      ytUnsubRef.current?.();
    };
  }, []);

  // ── Load project list ──────────────────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await fetchProjects();
      setProjects(list);
    } catch {
      // Silently handle — network may be down
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // ── Upload handler (local file) ───────────────────────────────────────────
  const handleFileSelected = useCallback(async (file: File) => {
    abortRef.current = new AbortController();

    setIngestState({ status: 'uploading', progress: 0, filename: file.name });

    try {
      const resp = await uploadProjectFile(
        file,
        (pct) =>
          setIngestState((s) =>
            s.status === 'uploading' ? { ...s, progress: pct } : s
          ),
        abortRef.current.signal
      );
      setIngestState({ status: 'success', project: resp.project });
      loadProjects(); // refresh list
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Upload cancelled') {
        setIngestState({ status: 'idle' });
      } else {
        setIngestState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Upload gagal.',
        });
      }
    }
  }, [loadProjects]);

  const cancelUpload = () => {
    abortRef.current?.abort();
    setIngestState({ status: 'idle' });
  };

  // ── YouTube Ingest handler ─────────────────────────────────────────────────
  const handleYouTubeStarted = useCallback(
    (projectId: string, jobId: string, url: string) => {
      ytUnsubRef.current?.();

      setIngestState({
        status: 'downloading_yt',
        projectId,
        jobId,
        progress: 0,
        url,
      });

      ytUnsubRef.current = subscribeJobEvents(
        jobId,
        (job) => {
          setIngestState((prev) => {
            if (prev.status !== 'downloading_yt') return prev;
            return {
              ...prev,
              progress: job.progress,
            };
          });

          if (job.status === 'completed') {
            ytUnsubRef.current?.();
            fetchProject(projectId)
              .then((p) => {
                setIngestState({ status: 'success', project: p });
                loadProjects();
              })
              .catch((err) => {
                setIngestState({
                  status: 'error',
                  message: err instanceof Error ? err.message : 'Gagal memuat metadata video.',
                });
              });
          } else if (job.status === 'failed') {
            ytUnsubRef.current?.();
            setIngestState({
              status: 'error',
              message: job.error_message || 'Unduhan YouTube gagal.',
            });
          } else if (job.status === 'cancelled') {
            ytUnsubRef.current?.();
            setIngestState({ status: 'idle' });
          }
        },
        (err) => {
          console.error('SSE connection error:', err);
        }
      );
    },
    [loadProjects]
  );

  const cancelYouTubeDownload = async () => {
    if (ingestState.status === 'downloading_yt') {
      try {
        await cancelJob(ingestState.jobId);
      } catch {
        // ignore
      }
      ytUnsubRef.current?.();
      setIngestState({ status: 'idle' });
    }
  };

  // ── Delete handler ─────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('Hapus proyek ini dan semua file videonya?')) return;
      setDeletingId(id);
      try {
        await deleteProject(id);
        setProjects((prev) => prev.filter((p) => p.id !== id));
        setIngestState((s) => {
          if (s.status === 'success' && s.project.id === id) return { status: 'idle' };
          return s;
        });
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Gagal menghapus proyek.');
      } finally {
        setDeletingId(null);
      }
    },
    []
  );

  // ── Select a project from list ─────────────────────────────────────────────
  const handleSelectProject = useCallback((item: ProjectListItem) => {
    fetchProject(item.id).then((p) => {
      setIngestState({ status: 'success', project: p });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Page title */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.3px',
            marginBottom: 4,
          }}
        >
          Upload &amp; Kelola Video
        </h1>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Unggah file video lokal atau unduh langsung dari YouTube, lalu ekstrak metadata ffprobe secara otomatis.
        </p>
      </div>

      <div className="dashboard-grid">
        {/* ── Left: Upload + Preview ─────────────────────────────────────── */}
        <div className="col-8">
          <div className="card" style={{ marginBottom: 20 }}>
            {/* Header with Minimalist Tab Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 14,
                marginBottom: 14,
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {tab === 'file' ? <Upload size={14} /> : <LinkIcon size={14} />}
                <span>
                  {ingestState.status === 'downloading_yt'
                    ? 'Proses Unduhan YouTube'
                    : ingestState.status === 'uploading'
                    ? 'Mengunggah File'
                    : 'Pilih Sumber Media'}
                </span>
              </div>

              {/* Tab Selector (only visible in idle state) */}
              {ingestState.status === 'idle' && (
                <div
                  style={{
                    display: 'flex',
                    gap: 3,
                    background: 'var(--bg-app)',
                    padding: 3,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <button
                    id="tab-upload-file"
                    type="button"
                    className={`btn btn-sm ${tab === 'file' ? 'btn-secondary' : 'btn-ghost'}`}
                    onClick={() => setTab('file')}
                    style={{ padding: '4px 10px', fontSize: 11 }}
                  >
                    <Upload size={12} />
                    Upload File
                  </button>
                  <button
                    id="tab-youtube-url"
                    type="button"
                    className={`btn btn-sm ${tab === 'youtube' ? 'btn-secondary' : 'btn-ghost'}`}
                    onClick={() => setTab('youtube')}
                    style={{ padding: '4px 10px', fontSize: 11 }}
                  >
                    <LinkIcon size={12} />
                    YouTube URL
                  </button>
                </div>
              )}
            </div>

            {/* Idle: show chosen tab */}
            {ingestState.status === 'idle' && (
              <>
                {tab === 'file' ? (
                  <UploadZone onFileSelected={handleFileSelected} />
                ) : (
                  <YouTubeIngestZone onIngestStarted={handleYouTubeStarted} />
                )}
              </>
            )}

            {/* Uploading File: progress bar */}
            {ingestState.status === 'uploading' && (
              <div
                id="upload-progress-panel"
                style={{
                  padding: '20px 0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {ingestState.filename}
                    </span>
                    &nbsp;— Mengunggah...
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-primary)',
                        fontWeight: 600,
                      }}
                    >
                      {ingestState.progress}%
                    </span>
                    <button
                      id="btn-cancel-upload"
                      className="btn btn-ghost btn-sm"
                      onClick={cancelUpload}
                      aria-label="Batalkan upload"
                      style={{ padding: '3px 8px' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
                <div className="upload-progress-track">
                  <div
                    className="upload-progress-fill"
                    style={{ width: `${ingestState.progress}%` }}
                    role="progressbar"
                    aria-valuenow={ingestState.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
                {ingestState.progress === 100 && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                    }}
                  >
                    File terkirim — mengekstrak metadata video...
                  </div>
                )}
              </div>
            )}

            {/* Downloading YouTube: Real-time SSE Progress */}
            {ingestState.status === 'downloading_yt' && (
              <div
                id="youtube-progress-panel"
                style={{
                  padding: '16px 0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                      Mengunduh Video YouTube...
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        maxWidth: 420,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {ingestState.url}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-primary)',
                        fontWeight: 600,
                      }}
                    >
                      {ingestState.progress}%
                    </span>
                    <button
                      id="btn-cancel-youtube"
                      className="btn btn-ghost btn-sm"
                      onClick={cancelYouTubeDownload}
                      aria-label="Batalkan unduhan YouTube"
                      style={{ padding: '3px 8px' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>

                <div className="upload-progress-track">
                  <div
                    className="upload-progress-fill"
                    style={{ width: `${ingestState.progress}%` }}
                    role="progressbar"
                    aria-valuenow={ingestState.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>

                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Loader2 size={11} className="spin" />
                  {ingestState.progress < 10 && 'Mengambil info metadata video...'}
                  {ingestState.progress >= 10 && ingestState.progress < 90 && 'Mengunduh stream video & audio (maks 1080p)...'}
                  {ingestState.progress >= 90 && 'Mengekstrak metadata media & menyimpan proyek...'}
                </div>
              </div>
            )}

            {/* Error */}
            {ingestState.status === 'error' && (
              <div
                id="ingest-error-panel"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  padding: '8px 0',
                }}
              >
                <div
                  style={{
                    background: 'var(--status-err-bg)',
                    border: '1px solid var(--status-err-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    fontSize: 12,
                    color: 'var(--status-err)',
                  }}
                >
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <strong style={{ display: 'block', marginBottom: 2 }}>
                      Proses Gagal
                    </strong>
                    {ingestState.message}
                  </div>
                </div>
                <button
                  id="btn-retry-ingest"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setIngestState({ status: 'idle' })}
                  style={{ alignSelf: 'flex-start' }}
                >
                  <RotateCcw size={12} />
                  Coba Lagi
                </button>
              </div>
            )}

            {/* Success: show overview */}
            {ingestState.status === 'success' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <VideoOverviewCard
                  project={ingestState.project}
                  onContinue={() => handleContinueToEditor(ingestState.project)}
                />
                <div className="divider" />
                <button
                  id="btn-upload-another"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setIngestState({ status: 'idle' })}
                  style={{ alignSelf: 'flex-start' }}
                >
                  <Upload size={12} />
                  Proses Video Lain
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Saved Projects list ─────────────────────────────────── */}
        <div className="col-4">
          <div className="card">
            <div className="section-header">
              <span className="section-title">
                <FolderOpen size={14} />
                Proyek Tersimpan
              </span>
              <span className="section-count">
                {loadingList ? '…' : projects.length}
              </span>
            </div>

            {loadingList ? (
              <div style={{ padding: '16px 0', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                Memuat...
              </div>
            ) : (
              <ProjectList
                projects={projects}
                onSelect={handleSelectProject}
                onDelete={handleDelete}
                deletingId={deletingId}
              />
            )}
          </div>
        </div>
      </div>

      {/* Standalone Interactive Studio Editor Overlay */}
      {activeStudioClip && (
        <ClipEditorStudio
          clip={activeStudioClip}
          isOpen={Boolean(activeStudioClip)}
          onClose={() => setActiveStudioClip(null)}
          onClipUpdated={(c) => {
            setActiveStudioClip(c);
            loadProjects();
          }}
        />
      )}
    </div>
  );
}
