/**
 * features/clips/ClipCard.tsx — Curated AI Short-Form Clip Card.
 *
 * Displays:
 * - Virality score badge (emerald for high score)
 * - Category badge and duration
 * - Title, hook quote, and editorial rationale
 * - "Preview Klip" action with bounded loop playback
 * - Inline trim point editor (start_time, end_time)
 * - Approval status toggle & "Siapkan untuk Ekspor" CTA
 */
import type React from 'react';
import { useState } from 'react';
import {
  Play,
  Pause,
  Scissors,
  Check,
  Trash2,
  Share2,
  Clock,
  Flame,
  CheckCircle2,
  X,
  Sparkles,
} from 'lucide-react';
import type { ClipCandidate, ClipCandidateUpdate, ClipStatus } from '../../types/clip';
import { ExportModal } from './ExportModal';
import { ClipEditorStudio } from './ClipEditorStudio';

interface Props {
  clip: ClipCandidate;
  isPreviewing: boolean;
  onPreview: (start: number, end: number, clipId: string) => void;
  onStopPreview: () => void;
  onUpdate: (clipId: string, updates: ClipCandidateUpdate) => Promise<void>;
  onDelete: (clipId: string) => Promise<void>;
  onRefresh?: () => void;
}

export const ClipCard: React.FC<Props> = ({
  clip,
  isPreviewing,
  onPreview,
  onStopPreview,
  onUpdate,
  onDelete,
  onRefresh,
}) => {
  const [isEditingTrim, setIsEditingTrim] = useState(false);
  const [trimStart, setTrimStart] = useState<number>(clip.start_time);
  const [trimEnd, setTrimEnd] = useState<number>(clip.end_time);
  const [isSavingTrim, setIsSavingTrim] = useState(false);
  const [trimError, setTrimError] = useState<string | null>(null);

  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isStudioOpen, setIsStudioOpen] = useState(false);

  const duration = Math.max(0, clip.end_time - clip.start_time);
  const formatSec = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  const handleSaveTrim = async () => {
    if (trimEnd <= trimStart) {
      setTrimError('Waktu selesai harus lebih besar dari waktu mulai.');
      return;
    }
    setTrimError(null);
    setIsSavingTrim(true);
    try {
      await onUpdate(clip.id, {
        start_time: Number(trimStart.toFixed(2)),
        end_time: Number(trimEnd.toFixed(2)),
      });
      setIsEditingTrim(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan trim.';
      setTrimError(msg);
    } finally {
      setIsSavingTrim(false);
    }
  };

  const handleStatusToggle = async (newStatus: ClipStatus) => {
    setIsUpdatingStatus(true);
    try {
      await onUpdate(clip.id, { status: newStatus });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handlePrepareExport = async () => {
    if (clip.status !== 'approved') {
      await handleStatusToggle('approved');
    }
    setIsExportModalOpen(true);
  };

  // Score styling
  const isHighVirality = clip.virality_score >= 80;
  const isMediumVirality = clip.virality_score >= 60;
  const scoreColor = isHighVirality
    ? 'var(--status-ok)'
    : isMediumVirality
    ? 'var(--status-warn)'
    : 'var(--text-secondary)';
  const scoreBg = isHighVirality
    ? 'var(--status-ok-bg)'
    : isMediumVirality
    ? 'var(--status-warn-bg)'
    : 'var(--bg-surface-elevated)';
  const scoreBorder = isHighVirality
    ? 'var(--status-ok-border)'
    : isMediumVirality
    ? 'var(--status-warn-border)'
    : 'var(--border-subtle)';

  return (
    <div
      id={`clip-card-${clip.id}`}
      className="clip-candidate-card"
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: isPreviewing ? '1px solid var(--accent-neutral)' : '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        position: 'relative',
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
      }}
    >
      {/* Top Header: Category, Duration, & Virality Score */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Category Pill */}
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              padding: '2px 8px',
              borderRadius: 'var(--radius-pill)',
              backgroundColor: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
            }}
          >
            {clip.category || 'Momen Viral'}
          </span>

          {/* Duration Badge */}
          <span
            style={{
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <Clock size={12} />
            {duration.toFixed(1)}s ({formatSec(clip.start_time)} - {formatSec(clip.end_time)})
          </span>

          {clip.auto_zoom && clip.auto_zoom !== 'none' && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: 'var(--radius-pill)',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
              title={`Dynamic Auto-Zoom aktif: ${clip.auto_zoom}`}
            >
              <Sparkles size={10} color="var(--accent-neutral)" />
              {clip.auto_zoom === 'subtle' ? 'Zoom 1.1x' : 'Zoom 1.2x'}
            </span>
          )}
        </div>

        {/* Virality Score Badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 'var(--radius-pill)',
            backgroundColor: scoreBg,
            border: `1px solid ${scoreBorder}`,
            color: scoreColor,
            fontSize: 12,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
          }}
          title="Estimasi Skor Viralitas AI (1-100) berdasarkan retensi hook dan shareability"
        >
          <Flame size={13} />
          <span>{clip.virality_score}</span>
          <span style={{ fontSize: 10, opacity: 0.7 }}>/100</span>
        </div>
      </div>

      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <h4
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
            lineHeight: 1.4,
            margin: 0,
          }}
        >
          {clip.title}
        </h4>

        {/* Status Pill */}
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 'var(--radius-xs)',
            textTransform: 'uppercase',
            letterSpacing: '0.4px',
            backgroundColor:
              clip.status === 'approved'
                ? 'var(--status-ok-bg)'
                : clip.status === 'rejected'
                ? 'var(--status-err-bg)'
                : 'var(--bg-surface-elevated)',
            color:
              clip.status === 'approved'
                ? 'var(--status-ok)'
                : clip.status === 'rejected'
                ? 'var(--status-err)'
                : 'var(--text-muted)',
            border: `1px solid ${
              clip.status === 'approved'
                ? 'var(--status-ok-border)'
                : clip.status === 'rejected'
                ? 'var(--status-err-border)'
                : 'var(--border-subtle)'
            }`,
          }}
        >
          {clip.status === 'approved' ? 'Disetujui' : clip.status === 'rejected' ? 'Ditolak' : 'Saran AI'}
        </span>
      </div>

      {/* Hook Section */}
      {clip.hook && (
        <div
          style={{
            backgroundColor: 'var(--bg-app)',
            borderLeft: '3px solid var(--accent-neutral)',
            padding: '8px 12px',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
            fontSize: 12,
            color: 'var(--text-primary)',
            fontStyle: 'italic',
          }}
        >
          "{clip.hook}"
        </div>
      )}

      {/* Editorial Rationale */}
      {clip.rationale && (
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {clip.rationale}
        </p>
      )}

      {/* Inline Trim Editor */}
      {isEditingTrim && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            marginTop: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
              Edit Titik Potong (Trim)
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '2px 6px', height: 'auto' }}
              onClick={() => setIsEditingTrim(false)}
            >
              <X size={13} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label
                htmlFor={`trim-start-${clip.id}`}
                style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}
              >
                Mulai (detik)
              </label>
              <input
                id={`trim-start-${clip.id}`}
                type="number"
                step="0.5"
                min="0"
                value={trimStart}
                onChange={(e) => setTrimStart(parseFloat(e.target.value) || 0)}
                style={{
                  width: '100%',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-xs)',
                  color: 'var(--text-primary)',
                  padding: '6px 8px',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>
            <div>
              <label
                htmlFor={`trim-end-${clip.id}`}
                style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}
              >
                Selesai (detik)
              </label>
              <input
                id={`trim-end-${clip.id}`}
                type="number"
                step="0.5"
                min="0"
                value={trimEnd}
                onChange={(e) => setTrimEnd(parseFloat(e.target.value) || 0)}
                style={{
                  width: '100%',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-xs)',
                  color: 'var(--text-primary)',
                  padding: '6px 8px',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Durasi Baru: {(Math.max(0, trimEnd - trimStart)).toFixed(1)}s ({formatSec(trimStart)} - {formatSec(trimEnd)})
          </div>

          {trimError && (
            <div style={{ fontSize: 11, color: 'var(--status-err)' }}>{trimError}</div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}
              onClick={() => {
                setTrimStart(clip.start_time);
                setTrimEnd(clip.end_time);
                setIsEditingTrim(false);
              }}
              disabled={isSavingTrim}
            >
              Batal
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}
              onClick={handleSaveTrim}
              disabled={isSavingTrim}
            >
              <Check size={12} />
              {isSavingTrim ? 'Menyimpan...' : 'Simpan Titik Potong'}
            </button>
          </div>
        </div>
      )}

      {/* Render & Export Modal */}
      <ExportModal
        clip={clip}
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        onClipRendered={() => {
          onRefresh?.();
        }}
      />

      {/* Interactive Clip Studio Editor (Milestone 6) */}
      <ClipEditorStudio
        clip={clip}
        isOpen={isStudioOpen}
        onClose={() => setIsStudioOpen(false)}
        onClipUpdated={() => {
          onRefresh?.();
        }}
        onClipRendered={() => {
          onRefresh?.();
        }}
      />

      {/* Action Footer Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: 4,
          paddingTop: 10,
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {/* Left: Preview, Trim, & Studio Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className={isPreviewing ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ fontSize: 12, padding: '6px 12px', height: '32px' }}
            onClick={() => {
              if (isPreviewing) {
                onStopPreview();
              } else {
                onPreview(clip.start_time, clip.end_time, clip.id);
              }
            }}
          >
            {isPreviewing ? <Pause size={13} /> : <Play size={13} />}
            {isPreviewing ? 'Stop Preview' : 'Preview Klip'}
          </button>

          <button
            id={`btn-open-studio-${clip.id}`}
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: '6px 11px', height: '32px' }}
            onClick={() => setIsStudioOpen(true)}
            title="Buka Interactive Clip Studio (Edit Subtitle, Visual Trim, & Dynamic Auto-Zoom)"
          >
            <Sparkles size={13} color="var(--accent-neutral)" />
            Studio Editor
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '6px 10px', height: '32px' }}
            onClick={() => setIsEditingTrim(!isEditingTrim)}
            title="Ubah titik mulai dan selesai klip secara manual"
          >
            <Scissors size={13} />
            Trim
          </button>

          {clip.render_status === 'completed' && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 'var(--radius-pill)',
                backgroundColor: 'var(--status-ok-bg)',
                border: '1px solid var(--status-ok-border)',
                color: 'var(--status-ok)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <CheckCircle2 size={12} />
              MP4 9:16 Siap
            </span>
          )}
        </div>

        {/* Right: Approve & Prepare for Export */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className={clip.status === 'approved' ? 'btn btn-secondary' : 'btn btn-ghost'}
            style={{ fontSize: 12, padding: '6px 10px', height: '32px' }}
            onClick={() => handleStatusToggle(clip.status === 'approved' ? 'suggested' : 'approved')}
            disabled={isUpdatingStatus}
            title={clip.status === 'approved' ? 'Batalkan persetujuan' : 'Tandai klip sebagai disetujui'}
          >
            <Check size={13} color={clip.status === 'approved' ? 'var(--status-ok)' : 'currentColor'} />
            {clip.status === 'approved' ? 'Disetujui' : 'Setujui'}
          </button>

          <button
            id={`btn-export-clip-${clip.id}`}
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '6px 12px', height: '32px' }}
            onClick={handlePrepareExport}
            title="Buka panel konfigurasi render dan ekspor 9:16 vertikal"
          >
            <Share2 size={13} />
            {clip.render_status === 'completed' ? 'Lihat Hasil Render' : 'Siapkan untuk Ekspor'}
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            style={{
              padding: '6px 8px',
              height: '32px',
              color: 'var(--text-muted)',
            }}
            onClick={() => onDelete(clip.id)}
            title="Hapus kandidat klip ini"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
