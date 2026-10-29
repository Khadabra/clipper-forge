/**
 * features/clips/ClipFinderView.tsx — Curated Viral Clip Finder Workspace.
 *
 * Clean Zinc Workstation UI (#09090b, border #27272a).
 * Displays viral clip candidates for the active project with virality score,
 * hook summaries, AI scan trigger, and [Buka di Studio Editor] navigation.
 */
import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import {
  Scissors,
  Sparkles,
  Flame,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sliders,
  RotateCcw,
  Film,
  Plus,
} from 'lucide-react';
import type { ClipCandidate } from '../../types/clip';
import type { ProjectListItem } from '../../types/project';
import {
  fetchClips,
  triggerFindClips,
  createManualClip,
  updateClip,
  deleteClip,
} from '../../services/clipsApi';
import { subscribeJobEvents } from '../../services/jobsApi';

interface ClipFinderViewProps {
  projects: ProjectListItem[];
  activeProject: ProjectListItem | null;
  onSelectProject: (project: ProjectListItem) => void;
  onOpenEditor: (clip: ClipCandidate) => void;
  onNavigateToProjects?: () => void;
}

export const ClipFinderView: React.FC<ClipFinderViewProps> = ({
  projects,
  activeProject,
  onSelectProject,
  onOpenEditor,
  onNavigateToProjects,
}) => {
  const [clips, setClips] = useState<ClipCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI Scan state
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStage, setScanStage] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'suggested'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreatingManual, setIsCreatingManual] = useState(false);

  const handleCreateManualClip = async () => {
    if (!activeProject) return;
    setIsCreatingManual(true);
    setError(null);
    try {
      const dur = activeProject.duration || 60;
      const newClip = await createManualClip(activeProject.id, {
        title: `Klip Manual ${clips.length + 1}`,
        start_time: 0.0,
        end_time: Math.min(dur, 30.0),
      });
      await loadClips();
      onOpenEditor(newClip);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat klip manual.';
      setError(msg);
    } finally {
      setIsCreatingManual(false);
    }
  };

  const loadClips = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchClips(activeProject.id);
      setClips(res.clips);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat kandidat klip.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    loadClips();
  }, [loadClips]);

  const handleTriggerAI = async () => {
    if (!activeProject) return;
    setError(null);
    setIsScanning(true);
    setScanProgress(5);
    setScanStage('Mempersiapkan analisis transkrip video...');

    try {
      const res = await triggerFindClips(activeProject.id);
      const cleanup = subscribeJobEvents(
        res.job_id,
        (job) => {
          setScanProgress(job.progress);
          if (job.progress >= 25 && job.progress < 50) {
            setScanStage('Menghubungkan ke Gemini AI & mendeteksi hook...');
          } else if (job.progress >= 50 && job.progress < 85) {
            setScanStage('Menghitung virality score dan segmen retensi tinggi...');
          } else if (job.progress >= 85) {
            setScanStage('Menyimpan klip viral ke database workstation...');
          }

          if (job.status === 'completed') {
            setIsScanning(false);
            loadClips();
            cleanup();
          } else if (job.status === 'failed') {
            setIsScanning(false);
            setError(job.error_message || 'Pemindaian klip gagal.');
            cleanup();
          }
        },
        () => {
          setIsScanning(false);
          cleanup();
        }
      );
    } catch (err: unknown) {
      setIsScanning(false);
      const msg = err instanceof Error ? err.message : 'Gagal memulai pemindaian AI.';
      setError(msg);
    }
  };

  const handleUpdateStatus = async (clipId: string, newStatus: 'approved' | 'suggested' | 'rejected') => {
    try {
      const updated = await updateClip(clipId, { status: newStatus });
      setClips((prev) => prev.map((c) => (c.id === clipId ? updated : c)));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Gagal memperbarui status klip.');
    }
  };

  const handleDeleteClip = async (clipId: string) => {
    if (!confirm('Hapus klip ini dari daftar kurasi?')) return;
    try {
      await deleteClip(clipId);
      setClips((prev) => prev.filter((c) => c.id !== clipId));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Gagal menghapus klip.');
    }
  };

  const filteredClips = clips.filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        c.title.toLowerCase().includes(q) ||
        (c.hook && c.hook.toLowerCase().includes(q)) ||
        (c.category && c.category.toLowerCase().includes(q))
      );
    }
    return true;
  });

  if (!activeProject && projects.length === 0) {
    return (
      <div
        style={{
          maxWidth: 620,
          margin: '60px auto',
          textAlign: 'center',
          padding: '40px 24px',
          background: 'var(--bg-surface)',
          border: '1px dashed var(--border-color)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-surface-elevated)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px auto',
            color: 'var(--text-muted)',
          }}
        >
          <Film size={22} />
        </div>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
          Belum Ada Proyek Video
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
          Silakan unggah video lokal atau masukkan link YouTube terlebih dahulu untuk memulai kurasi momen viral otomatis.
        </p>
        {onNavigateToProjects && (
          <button onClick={onNavigateToProjects} className="btn btn-primary">
            <Plus size={14} />
            Unggah / Import Video
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: '-0.3px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 4,
            }}
          >
            <Scissors size={20} color="#818cf8" />
            Kurasi Klip Viral &amp; Shorts Finder
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Kurasi segmen retensi tinggi berdasarkan analisis hook, sentimen percakapan, dan virality score AI.
          </p>
        </div>

        {/* Project Selector & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {projects.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Proyek:</span>
              <select
                value={activeProject?.id || ''}
                onChange={(e) => {
                  const p = projects.find((x) => x.id === e.target.value);
                  if (p) onSelectProject(p);
                }}
                style={{
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 10px',
                  fontSize: 12,
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title || p.original_filename}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={loadClips}
            disabled={loading || isScanning}
            className="btn btn-secondary btn-sm"
          >
            <RotateCcw size={12} className={loading ? 'spin' : ''} />
            Refresh
          </button>

          <button
            onClick={handleCreateManualClip}
            disabled={isCreatingManual || loading || isScanning || !activeProject}
            className="btn btn-secondary btn-sm"
            title="Buat klip baru dan potong/edit secara manual (CapCut style)"
          >
            {isCreatingManual ? (
              <Loader2 size={13} className="spin" />
            ) : (
              <Scissors size={13} />
            )}
            + Klip Manual
          </button>

          <button
            onClick={handleTriggerAI}
            disabled={isScanning || !activeProject}
            className="btn btn-primary btn-sm"
          >
            {isScanning ? (
              <Loader2 size={13} className="spin" />
            ) : (
              <Sparkles size={13} />
            )}
            {isScanning ? 'Memindai...' : 'Cari Momen Viral (AI)'}
          </button>
        </div>
      </div>

      {/* AI Scanning Progress Banner */}
      {isScanning && (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--accent-primary)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            marginBottom: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
              <Sparkles size={15} color="var(--accent-primary)" className="spin" />
              <span>{scanStage}</span>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-primary)', fontWeight: 700 }}>
              {scanProgress}%
            </span>
          </div>
          <div className="upload-progress-track">
            <div
              className="upload-progress-fill"
              style={{ width: `${scanProgress}%`, background: 'var(--accent-primary)' }}
            />
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          padding: '12px 16px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Cari judul atau hook..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              background: 'var(--bg-app)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              width: 260,
              outline: 'none',
            }}
          />

          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => setStatusFilter('all')}
              className={`btn btn-sm ${statusFilter === 'all' ? 'btn-secondary' : 'btn-ghost'}`}
              style={{ fontSize: 11 }}
            >
              Semua ({clips.length})
            </button>
            <button
              onClick={() => setStatusFilter('approved')}
              className={`btn btn-sm ${statusFilter === 'approved' ? 'btn-secondary' : 'btn-ghost'}`}
              style={{ fontSize: 11 }}
            >
              Approved ({clips.filter((c) => c.status === 'approved').length})
            </button>
            <button
              onClick={() => setStatusFilter('suggested')}
              className={`btn btn-sm ${statusFilter === 'suggested' ? 'btn-secondary' : 'btn-ghost'}`}
              style={{ fontSize: 11 }}
            >
              Suggested ({clips.filter((c) => c.status === 'suggested').length})
            </button>
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Proyek aktif:{' '}
          <strong style={{ color: 'var(--text-primary)' }}>
            {activeProject?.title || activeProject?.original_filename || 'Belum dipilih'}
          </strong>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div
          style={{
            background: 'var(--status-err-bg)',
            border: '1px solid var(--status-err-border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: 'var(--status-err)',
            fontSize: 13,
          }}
        >
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div
          style={{
            padding: '60px 0',
            textAlign: 'center',
            color: 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Loader2 size={24} className="spin" color="var(--accent-primary)" />
          <span style={{ fontSize: 13 }}>Memuat kandidat klip dari database...</span>
        </div>
      ) : filteredClips.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '50px 24px',
            background: 'var(--bg-surface)',
            border: '1px dashed var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            maxWidth: 600,
            margin: '30px auto',
          }}
        >
          <Scissors size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px auto' }} />
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Belum Ada Klip Viral Ditemukan
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 20 }}>
            Pindai transkrip video secara otomatis dengan AI untuk mengidentifikasi momen viral terbaik, atau buat klip manual untuk langsung diedit ala CapCut.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <button
              onClick={handleTriggerAI}
              disabled={isScanning}
              className="btn btn-primary"
            >
              <Sparkles size={14} />
              Mulai Cari Momen Viral (AI)
            </button>
            <button
              onClick={handleCreateManualClip}
              disabled={isCreatingManual || isScanning}
              className="btn btn-secondary"
              title="Buat klip baru dan potong/edit secara manual ala CapCut"
            >
              {isCreatingManual ? <Loader2 size={14} className="spin" /> : <Scissors size={14} />}
              + Buat Klip Manual (CapCut Style)
            </button>
          </div>
        </div>
      ) : (
        /* Clips Grid */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
            gap: 18,
          }}
        >
          {filteredClips.map((clip) => {
            const duration = Math.max(1, Math.round(clip.end_time - clip.start_time));
            return (
              <div
                key={clip.id}
                className="card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  gap: 12,
                  transition: 'border-color 0.15s ease',
                }}
              >
                {/* Header row: Virality score & Status */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'rgba(245, 158, 11, 0.15)',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#fbbf24',
                    }}
                  >
                    <Flame size={12} />
                    <span>{clip.virality_score}/100 VIRAL</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-pill)',
                        background:
                          clip.status === 'approved'
                            ? 'rgba(16, 185, 129, 0.15)'
                            : 'var(--bg-surface-elevated)',
                        color:
                          clip.status === 'approved'
                            ? 'var(--status-ok)'
                            : 'var(--text-muted)',
                        border: '1px solid var(--border-subtle)',
                        fontWeight: 600,
                      }}
                    >
                      {clip.status.toUpperCase()}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {duration} detik
                    </span>
                  </div>
                </div>

                {/* Title */}
                <h3
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    lineHeight: 1.4,
                    margin: 0,
                  }}
                >
                  {clip.title}
                </h3>

                {/* Hook banner */}
                {clip.hook && (
                  <div
                    style={{
                      background: 'var(--bg-app)',
                      borderLeft: '3px solid #818cf8',
                      padding: '8px 12px',
                      borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      fontStyle: 'italic',
                      lineHeight: 1.4,
                    }}
                  >
                    &ldquo;{clip.hook}&rdquo;
                  </div>
                )}

                {/* Rationale */}
                {clip.rationale && (
                  <p
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      lineHeight: 1.4,
                      margin: 0,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {clip.rationale}
                  </p>
                )}

                {/* Meta details & duration bounds */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    paddingTop: 8,
                    borderTop: '1px solid var(--border-subtle)',
                    marginTop: 'auto',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={11} />
                    <span>
                      {Math.floor(clip.start_time / 60)}:
                      {String(Math.floor(clip.start_time % 60)).padStart(2, '0')}{' '}
                      &rarr;{' '}
                      {Math.floor(clip.end_time / 60)}:
                      {String(Math.floor(clip.end_time % 60)).padStart(2, '0')}
                    </span>
                  </div>

                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: 3,
                      background: 'var(--bg-app)',
                      fontSize: 10,
                    }}
                  >
                    {clip.category || 'Highlight'}
                  </span>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    onClick={() => onOpenEditor(clip)}
                    className="btn btn-primary btn-sm"
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    <Sliders size={13} />
                    Buka di Studio Editor
                  </button>

                  {clip.status !== 'approved' ? (
                    <button
                      onClick={() => handleUpdateStatus(clip.id, 'approved')}
                      className="btn btn-secondary btn-sm"
                      title="Setujui klip ini"
                    >
                      <CheckCircle2 size={13} color="var(--status-ok)" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpdateStatus(clip.id, 'suggested')}
                      className="btn btn-ghost btn-sm"
                      title="Kembalikan ke saran"
                    >
                      Undo
                    </button>
                  )}

                  <button
                    onClick={() => handleDeleteClip(clip.id)}
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--status-err)' }}
                    title="Hapus klip"
                  >
                    &times;
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
