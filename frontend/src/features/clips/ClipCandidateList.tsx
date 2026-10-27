/**
 * features/clips/ClipCandidateList.tsx — Curated Shorts Hub & AI Clip Finder.
 *
 * Provides:
 * - Trigger action "Cari Momen Viral (AI)"
 * - Real-time SSE progress bar during AI scanning (10% - 100%)
 * - List of curated clip cards sorted by virality score
 * - Bounded preview playback handler (loops start_time to end_time)
 * - Clip trim edit and status management
 */
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  Loader2,
  AlertCircle,
  Filter,
  Flame,
  RefreshCw,
} from 'lucide-react';
import type { ClipCandidate, ClipCandidateUpdate } from '../../types/clip';
import {
  fetchClips,
  triggerFindClips,
  updateClip,
  deleteClip,
} from '../../services/clipsApi';
import { subscribeJobEvents } from '../../services/jobsApi';
import { ClipCard } from './ClipCard';

interface Props {
  projectId: string;
  currentTime: number;
  onSeek: (seconds: number) => void;
  onPause?: () => void;
  onPlay?: () => void;
}

export const ClipCandidateList: React.FC<Props> = ({
  projectId,
  currentTime,
  onSeek,
  onPause,
  onPlay,
}) => {
  const [clips, setClips] = useState<ClipCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFindingClips, setIsFindingClips] = useState(false);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobStage, setJobStage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [filterApprovedOnly, setFilterApprovedOnly] = useState(false);

  // Active clip preview bounds
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [previewBounds, setPreviewBounds] = useState<{ start: number; end: number } | null>(null);

  // 1. Fetch existing clips
  const loadClips = useCallback(async () => {
    try {
      setError(null);
      const res = await fetchClips(projectId);
      setClips(res.clips);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat kandidat klip.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadClips();
  }, [loadClips]);

  // 2. Bounded preview playback enforcement
  useEffect(() => {
    if (previewBounds && previewClipId) {
      if (currentTime >= previewBounds.end) {
        // Loop back to clip start
        onSeek(previewBounds.start);
      } else if (currentTime < previewBounds.start - 0.5) {
        // Seek to start if drifted
        onSeek(previewBounds.start);
      }
    }
  }, [currentTime, previewBounds, previewClipId, onSeek]);

  const handleStartPreview = (start: number, end: number, clipId: string) => {
    setPreviewClipId(clipId);
    setPreviewBounds({ start, end });
    onSeek(start);
    onPlay?.();
  };

  const handleStopPreview = () => {
    setPreviewClipId(null);
    setPreviewBounds(null);
    onPause?.();
  };

  // 3. Trigger AI Clip Finder
  const handleFindClips = async () => {
    setError(null);
    setIsFindingClips(true);
    setJobProgress(5);
    setJobStage('Menyiapkan transkrip untuk analisis AI...');

    try {
      const res = await triggerFindClips(projectId);

      // Subscribe to real-time SSE progress
      const cleanup = subscribeJobEvents(
        res.job_id,
        (job) => {
          setJobProgress(job.progress);
          if (job.progress >= 30 && job.progress < 50) {
            setJobStage('Menghubungkan ke Gemini AI...');
          } else if (job.progress >= 50 && job.progress < 90) {
            setJobStage('Mengkurasi klip dengan retensi dan hook tertinggi...');
          } else if (job.progress >= 90) {
            setJobStage('Menyimpan kandidat klip ke database...');
          }

          if (job.status === 'completed') {
            setIsFindingClips(false);
            loadClips();
            cleanup();
          } else if (job.status === 'failed') {
            setIsFindingClips(false);
            setError(job.error_message || 'Proses kurasi klip gagal. Silakan coba lagi.');
            cleanup();
          }
        },
        () => {
          setIsFindingClips(false);
          setError('Koneksi pemantauan klip terputus.');
        }
      );
    } catch (err: unknown) {
      setIsFindingClips(false);
      const msg = err instanceof Error ? err.message : 'Gagal memulai pencarian klip.';
      setError(msg);
    }
  };

  // 4. Update clip
  const handleUpdateClip = async (clipId: string, updates: ClipCandidateUpdate) => {
    const updated = await updateClip(clipId, updates);
    setClips((prev) => prev.map((c) => (c.id === clipId ? updated : c)));

    // Update active preview bounds if currently previewing this clip
    if (previewClipId === clipId) {
      setPreviewBounds({ start: updated.start_time, end: updated.end_time });
    }
  };

  // 5. Delete clip
  const handleDeleteClip = async (clipId: string) => {
    if (previewClipId === clipId) {
      handleStopPreview();
    }
    await deleteClip(clipId);
    setClips((prev) => prev.filter((c) => c.id !== clipId));
  };

  const displayedClips = filterApprovedOnly
    ? clips.filter((c) => c.status === 'approved')
    : clips;

  return (
    <div
      id="curated-shorts-hub"
      className="curated-shorts-hub"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        marginTop: '16px',
        paddingTop: '16px',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} color="var(--status-ok)" />
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Curated Shorts Hub
          </h3>
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-pill)',
              backgroundColor: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-muted)',
            }}
          >
            {clips.length} Klip
          </span>
        </div>

        {/* Action Button & Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {clips.length > 0 && (
            <button
              type="button"
              className={filterApprovedOnly ? 'btn btn-secondary' : 'btn btn-ghost'}
              style={{ fontSize: 11, padding: '4px 10px', height: '28px' }}
              onClick={() => setFilterApprovedOnly(!filterApprovedOnly)}
            >
              <Filter size={12} />
              {filterApprovedOnly ? 'Semua Klip' : 'Hanya Disetujui'}
            </button>
          )}

          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '4px 8px', height: '28px' }}
            onClick={loadClips}
            disabled={isLoading || isFindingClips}
            title="Muat ulang daftar klip"
          >
            <RefreshCw size={12} className={isLoading ? 'spin' : ''} />
          </button>

          <button
            id="btn-find-clips-ai"
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '6px 14px', height: '32px' }}
            onClick={handleFindClips}
            disabled={isFindingClips}
          >
            {isFindingClips ? (
              <>
                <Loader2 size={13} className="spin" />
                <span>Menganalisis Transkrip...</span>
              </>
            ) : (
              <>
                <Flame size={13} color="var(--status-ok)" />
                <span>Cari Momen Viral (AI)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div
          style={{
            backgroundColor: 'var(--status-err-bg)',
            border: '1px solid var(--status-err-border)',
            color: 'var(--status-err)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* Active SSE Scanning Progress Bar */}
      {isFindingClips && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Loader2 size={15} className="spin" color="var(--status-ok)" />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                Gemini AI sedang memindai transkrip...
              </span>
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--status-ok)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {jobProgress}%
            </span>
          </div>

          {/* Progress bar line */}
          <div
            style={{
              width: '100%',
              height: 6,
              backgroundColor: 'var(--bg-app)',
              borderRadius: 'var(--radius-pill)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${jobProgress}%`,
                height: '100%',
                backgroundColor: 'var(--status-ok)',
                transition: 'width 0.25s ease',
              }}
            />
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {jobStage || 'Mendeteksi hook, resonansi emosional, dan durasi retensi tinggi...'}
          </div>
        </div>
      )}

      {/* Clip Candidates List */}
      {isLoading && !isFindingClips ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          <Loader2 size={20} className="spin" style={{ margin: '0 auto 8px auto' }} />
          <span>Memuat kandidat klip...</span>
        </div>
      ) : displayedClips.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {displayedClips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              isPreviewing={previewClipId === clip.id}
              onPreview={handleStartPreview}
              onStopPreview={handleStopPreview}
              onUpdate={handleUpdateClip}
              onDelete={handleDeleteClip}
              onRefresh={loadClips}
            />
          ))}
        </div>
      ) : !isFindingClips ? (
        <div
          style={{
            padding: '32px 16px',
            textAlign: 'center',
            backgroundColor: 'var(--bg-surface)',
            border: '1px dashed var(--border-medium)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-surface-elevated)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
            }}
          >
            <Sparkles size={20} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Belum Ada Klip yang Ditemukan
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 360, margin: 0 }}>
            Klik tombol "Cari Momen Viral (AI)" di atas untuk memindai transkrip video Anda dan menghasilkan 3–6 klip shorts berpotensi viral tinggi.
          </p>
        </div>
      ) : null}
    </div>
  );
};
