/**
 * features/projects/TranscriptStudio.tsx
 * Milestone 3 — Interactive Transcript Studio (faster-whisper) with Clean Zinc UI.
 *
 * Features:
 * - Model selector (Base [Cepat] / Small [Akurat])
 * - Live SSE progress tracking during extraction & transcription
 * - Interactive timestamped segments list with clickable video seeking
 * - Real-time full-text search filter
 * - Direct export to SRT, WebVTT, and Plain Text
 */
import type React from 'react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FileText,
  Search,
  Download,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Cpu,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import type { TranscriptSegment } from '../../types/transcript';
import {
  fetchTranscript,
  triggerTranscription,
  downloadTranscript,
} from '../../services/transcriptsApi';
import { subscribeJobEvents } from '../../services/jobsApi';

interface Props {
  projectId: string;
  currentTime?: number;
  onSeek?: (seconds: number) => void;
}

export const TranscriptStudio: React.FC<Props> = ({
  projectId,
  currentTime = 0,
  onSeek,
}) => {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modelSize, setModelSize] = useState<'base' | 'small'>('base');
  const [searchQuery, setSearchQuery] = useState('');
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);

  // Job progress tracking
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobPhase, setJobPhase] = useState<string>('');
  const unsubRef = useRef<(() => void) | null>(null);

  // ── Load existing transcript ───────────────────────────────────────────────
  const loadTranscript = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchTranscript(projectId);
      setSegments(data.segments);
    } catch {
      // Transcript might not exist yet
      setSegments([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadTranscript();
    return () => {
      unsubRef.current?.();
    };
  }, [loadTranscript]);

  // ── Trigger transcription ──────────────────────────────────────────────────
  const handleStartTranscription = async () => {
    setSubmitting(true);
    unsubRef.current?.();

    try {
      const resp = await triggerTranscription(projectId, { model_size: modelSize });
      setActiveJobId(resp.job_id);
      setJobProgress(0);
      setJobPhase('Mempersiapkan proses...');

      unsubRef.current = subscribeJobEvents(
        resp.job_id,
        (job) => {
          setJobProgress(job.progress);

          if (job.progress < 25) {
            setJobPhase('Mengekstrak audio WAV 16kHz via FFmpeg...');
          } else if (job.progress < 95) {
            setJobPhase(`Transkripsi AI dengan faster-whisper (${modelSize})...`);
          } else {
            setJobPhase('Menyimpan segmen teks & kata bertimestamp...');
          }

          if (job.status === 'completed') {
            unsubRef.current?.();
            setActiveJobId(null);
            loadTranscript();
          } else if (job.status === 'failed' || job.status === 'cancelled') {
            unsubRef.current?.();
            setActiveJobId(null);
            alert(job.error_message || 'Transkripsi gagal.');
          }
        },
        () => {
          unsubRef.current?.();
          setActiveJobId(null);
        }
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Gagal memulai transkripsi.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Export subtitles ───────────────────────────────────────────────────────
  const handleExport = async (format: 'srt' | 'vtt' | 'txt') => {
    setExportingFormat(format);
    try {
      await downloadTranscript(projectId, format);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Gagal mengunduh subtitle.');
    } finally {
      setExportingFormat(null);
    }
  };

  // ── Search filter ──────────────────────────────────────────────────────────
  const filteredSegments = useMemo(() => {
    if (!searchQuery.trim()) return segments;
    const q = searchQuery.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, searchQuery]);

  // Format MM:SS helper
  const formatTime = (seconds: number) => {
    const total = Math.floor(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div
      id="transcript-studio"
      style={{
        marginTop: 20,
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        padding: 18,
      }}
    >
      {/* ── Studio Header ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          paddingBottom: 14,
          borderBottom: '1px solid var(--border-color)',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={16} color="var(--text-muted)" />
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '-0.2px',
              }}
            >
              Transkrip Studio &amp; Subtitle
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Ekstraksi suara otomatis dengan faster-whisper AI &amp; word-level timestamps.
            </div>
          </div>
        </div>

        {/* Model selector & Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!activeJobId && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'var(--bg-app)',
                padding: '3px 6px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
              }}
            >
              <Cpu size={12} color="var(--text-muted)" />
              <select
                value={modelSize}
                onChange={(e) => setModelSize(e.target.value as 'base' | 'small')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-primary)',
                  fontSize: 11,
                  fontWeight: 600,
                  outline: 'none',
                  cursor: 'pointer',
                }}
                aria-label="Pilih model faster-whisper"
              >
                <option value="base" style={{ background: '#18181b', color: '#f4f4f5' }}>
                  Model Base (Cepat &amp; Ringan)
                </option>
                <option value="small" style={{ background: '#18181b', color: '#f4f4f5' }}>
                  Model Small (Lebih Akurat)
                </option>
              </select>
            </div>
          )}

          {/* Trigger button */}
          {!activeJobId && (
            <button
              id="btn-start-transcribe"
              className={segments.length === 0 ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              onClick={handleStartTranscription}
              disabled={submitting}
              type="button"
            >
              {submitting ? (
                <Loader2 size={12} className="spin" />
              ) : segments.length === 0 ? (
                <Sparkles size={12} />
              ) : (
                <RotateCcw size={12} />
              )}
              {segments.length === 0 ? 'Mulai Transkripsi' : 'Transkrip Ulang'}
            </button>
          )}

          {/* Export dropdown / buttons */}
          {segments.length > 0 && !activeJobId && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                id="btn-export-srt"
                className="btn btn-ghost btn-sm"
                onClick={() => handleExport('srt')}
                disabled={exportingFormat === 'srt'}
                title="Ekspor format subtitle SubRip (.srt)"
                type="button"
                style={{ fontSize: 11, padding: '4px 8px' }}
              >
                {exportingFormat === 'srt' ? (
                  <Loader2 size={11} className="spin" />
                ) : (
                  <Download size={11} />
                )}
                SRT
              </button>
              <button
                id="btn-export-vtt"
                className="btn btn-ghost btn-sm"
                onClick={() => handleExport('vtt')}
                disabled={exportingFormat === 'vtt'}
                title="Ekspor format subtitle WebVTT (.vtt)"
                type="button"
                style={{ fontSize: 11, padding: '4px 8px' }}
              >
                {exportingFormat === 'vtt' ? (
                  <Loader2 size={11} className="spin" />
                ) : (
                  <Download size={11} />
                )}
                VTT
              </button>
              <button
                id="btn-export-txt"
                className="btn btn-ghost btn-sm"
                onClick={() => handleExport('txt')}
                disabled={exportingFormat === 'txt'}
                title="Ekspor teks lengkap (.txt)"
                type="button"
                style={{ fontSize: 11, padding: '4px 8px' }}
              >
                {exportingFormat === 'txt' ? (
                  <Loader2 size={11} className="spin" />
                ) : (
                  <Download size={11} />
                )}
                TXT
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Active Job Progress Banner ─────────────────────────────────────── */}
      {activeJobId && (
        <div
          id="transcription-progress-panel"
          style={{
            padding: '14px 16px',
            marginBottom: 14,
            background: 'var(--bg-app)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Loader2 size={14} className="spin" color="var(--accent-amber, #f59e0b)" />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                {jobPhase || 'Memproses transkripsi video...'}
              </span>
            </div>
            <span
              style={{
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}
            >
              {jobProgress}%
            </span>
          </div>

          <div className="upload-progress-track">
            <div
              className="upload-progress-fill"
              style={{ width: `${jobProgress}%` }}
              role="progressbar"
              aria-valuenow={jobProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}

      {/* ── Search Bar (when transcript is ready) ───────────────────────────── */}
      {segments.length > 0 && !activeJobId && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              position: 'relative',
              flex: 1,
              maxWidth: 360,
            }}
          >
            <Search
              size={13}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              id="search-transcript-input"
              type="text"
              placeholder="Cari kata atau frasa dalam transkrip..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px 6px 30px',
                fontSize: 12,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-app)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
          </div>

          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {searchQuery.trim()
              ? `${filteredSegments.length} dari ${segments.length} baris`
              : `${segments.length} segmen terdeteksi`}
          </span>
        </div>
      )}

      {/* ── Content View ───────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          <Loader2 size={16} className="spin" style={{ display: 'inline-block', marginBottom: 6 }} />
          <div>Memuat transkrip...</div>
        </div>
      ) : segments.length === 0 && !activeJobId ? (
        <div
          style={{
            padding: '24px 16px',
            textAlign: 'center',
            border: '1px dashed var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-app)',
          }}
        >
          <Clock size={24} color="var(--text-muted)" style={{ margin: '0 auto 8px auto', opacity: 0.6 }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
            Belum Ada Transkrip
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 420, margin: '0 auto 14px auto' }}>
            Jalankan AI faster-whisper untuk mengekstrak transkrip percakapan, timestamps kata per kata, dan menghasilkan subtitle otomatis.
          </p>
          <button
            id="btn-trigger-initial-transcribe"
            className="btn btn-primary btn-sm"
            onClick={handleStartTranscription}
            disabled={submitting}
            type="button"
          >
            <Sparkles size={13} />
            Mulai Transkripsi Sekarang
          </button>
        </div>
      ) : (
        /* ── Segments List with Interactive Seeking ───────────────────────── */
        <div
          id="transcript-segments-container"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxHeight: 380,
            overflowY: 'auto',
            paddingRight: 4,
          }}
        >
          {filteredSegments.length === 0 ? (
            <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              Tidak ada kata yang cocok dengan pencarian &quot;{searchQuery}&quot;.
            </div>
          ) : (
            filteredSegments.map((segment) => {
              const isActive =
                currentTime >= segment.start_time && currentTime <= segment.end_time;

              return (
                <div
                  key={segment.id}
                  id={`segment-${segment.segment_index}`}
                  onClick={() => onSeek?.(segment.start_time)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: isActive ? 'rgba(255, 255, 255, 0.05)' : 'var(--bg-app)',
                    border: '1px solid',
                    borderColor: isActive ? 'var(--text-primary)' : 'var(--border-color)',
                    cursor: onSeek ? 'pointer' : 'default',
                    transition: 'all 0.15s ease',
                  }}
                  title={onSeek ? `Klik untuk lompat ke ${formatTime(segment.start_time)}` : undefined}
                >
                  {/* Timestamp Badge / Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek?.(segment.start_time);
                    }}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 4,
                      padding: '2px 6px',
                      color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <Play size={8} fill="currentColor" />
                    {formatTime(segment.start_time)} - {formatTime(segment.end_time)}
                  </button>

                  {/* Segment Text */}
                  <div
                    style={{
                      flex: 1,
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {segment.text}
                  </div>

                  {isActive && (
                    <CheckCircle2
                      size={12}
                      color="var(--accent-emerald, #10b981)"
                      style={{ flexShrink: 0, marginTop: 4 }}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
