/**
 * features/clips/ExportModal.tsx — 9:16 Vertical Cropper & Dynamic Subtitle Styler Modal.
 *
 * Allows users to:
 * - Choose Aspect Ratio (9:16, 1:1, 16:9)
 * - Select Crop Mode (Blur Background Fill vs Center Crop)
 * - Select Subtitle Style (Clean Minimalist, Bold Punchy Yellow, or None)
 * - Trigger FFmpeg background render job with real-time SSE progress
 * - Preview the rendered 9:16 video in an embedded vertical player
 * - Download the finished MP4 file directly
 */
import type React from 'react';
import { useState, useEffect } from 'react';
import {
  X,
  Film,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Smartphone,
  Square,
  Monitor,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import type {
  AspectRatio,
  AutoZoom,
  ClipCandidate,
  CropMode,
  SubtitleStyle,
} from '../../types/clip';
import {
  downloadRenderedClip,
  getRenderedClipStreamUrl,
  triggerRenderClip,
} from '../../services/clipsApi';
import { subscribeJobEvents } from '../../services/jobsApi';

interface Props {
  clip: ClipCandidate;
  isOpen: boolean;
  onClose: () => void;
  onClipRendered?: (clipId: string) => void;
}

const normalizeSubtitleStyle = (style?: string): SubtitleStyle => {
  if (
    style === 'hormozi' ||
    style === 'condensed_clean' ||
    style === 'boxed_vox' ||
    style === 'cyber_neon' ||
    style === 'word_highlight' ||
    style === 'none'
  ) {
    return style as SubtitleStyle;
  }
  if (style === 'bold_yellow' || style === 'red_punch') return 'hormozi';
  if (style === 'boxed_editorial') return 'boxed_vox';
  return 'condensed_clean';
};

const normalizeCropMode = (mode?: string): CropMode => {
  if (mode === 'center_crop' || mode === 'framed_headline' || mode === 'speaker_track') return mode;
  return 'blur_fill';
};

const normalizeAutoZoom = (zoom?: string): AutoZoom => {
  if (zoom === 'snap_hook' || zoom === 'none') return zoom;
  return 'subtle';
};

export const ExportModal: React.FC<Props> = ({
  clip,
  isOpen,
  onClose,
  onClipRendered,
}) => {
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(clip.aspect_ratio || '9:16');
  const [cropMode, setCropMode] = useState<CropMode>(normalizeCropMode(clip.crop_mode));
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(normalizeSubtitleStyle(clip.subtitle_style));
  const [autoZoom, setAutoZoom] = useState<AutoZoom>(normalizeAutoZoom(clip.auto_zoom));

  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [isCompleted, setIsCompleted] = useState(
    clip.render_status === 'completed' && Boolean(clip.rendered_file_path)
  );
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAspectRatio(clip.aspect_ratio || '9:16');
      setCropMode(normalizeCropMode(clip.crop_mode));
      setSubtitleStyle(normalizeSubtitleStyle(clip.subtitle_style));
      setAutoZoom(normalizeAutoZoom(clip.auto_zoom));
      setIsCompleted(clip.render_status === 'completed' && Boolean(clip.rendered_file_path));
      setError(null);
    }
  }, [isOpen, clip]);

  if (!isOpen) return null;

  const renderedVideoUrl = getRenderedClipStreamUrl(clip.project_id, clip.id);

  const handleStartRender = async () => {
    setError(null);
    setIsRendering(true);
    setRenderProgress(10);
    setRenderStage('Menyiapkan klip dan konfigurasi filter...');

    try {
      const res = await triggerRenderClip(clip.id, {
        aspect_ratio: aspectRatio,
        crop_mode: cropMode,
        subtitle_style: subtitleStyle,
        auto_zoom: autoZoom,
      });

      // Subscribe to real-time SSE progress
      const cleanup = subscribeJobEvents(
        res.job_id,
        (job) => {
          setRenderProgress(job.progress);

          if (job.progress >= 20 && job.progress < 50) {
            setRenderStage('Memotong rentang waktu & membuat subtitle ASS...');
          } else if (job.progress >= 50 && job.progress < 85) {
            setRenderStage('Rendering filter rasio & hardware encoding...');
          } else if (job.progress >= 85) {
            setRenderStage('Menyelesaikan file MP4 final...');
          }

          if (job.status === 'completed') {
            setIsRendering(false);
            setIsCompleted(true);
            onClipRendered?.(clip.id);
            cleanup();
          } else if (job.status === 'failed') {
            setIsRendering(false);
            setError(job.error_message || 'Proses render video gagal.');
            cleanup();
          }
        },
        () => {
          setIsRendering(false);
          setError('Koneksi pemantauan render terputus.');
        }
      );
    } catch (err: unknown) {
      setIsRendering(false);
      const msg = err instanceof Error ? err.message : 'Gagal memulai proses render.';
      setError(msg);
    }
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await downloadRenderedClip(clip.id, `clip_${clip.id.slice(0, 8)}_${aspectRatio.replace(':', '-')}.mp4`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengunduh video.';
      setError(msg);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
    >
      <div
        id="export-render-modal"
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-medium)',
          borderRadius: 'var(--radius-lg)',
          width: '100%',
          maxWidth: '580px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h3
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Film size={16} color="var(--accent-neutral)" />
              Render & Ekspor Video Shorts
            </h3>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {clip.title} ({(clip.end_time - clip.start_time).toFixed(1)}s)
            </span>
          </div>

          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '6px', height: 'auto', borderRadius: 'var(--radius-pill)' }}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
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

          {/* 1. Rendering Progress State */}
          {isRendering ? (
            <div
              style={{
                backgroundColor: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '24px 20px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <Loader2 size={32} className="spin" color="var(--status-ok)" />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Sedang Merender Video ({renderProgress}%)
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {renderStage || 'FFmpeg sedang memproses video dan subtitle...'}
                </div>
              </div>

              {/* Progress bar */}
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
                    width: `${renderProgress}%`,
                    height: '100%',
                    backgroundColor: 'var(--status-ok)',
                    transition: 'width 0.25s ease',
                  }}
                />
              </div>
            </div>
          ) : isCompleted ? (
            /* 2. Completed State: Video Player & Download */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
              <div
                style={{
                  width: '100%',
                  backgroundColor: 'var(--status-ok-bg)',
                  border: '1px solid var(--status-ok-border)',
                  color: 'var(--status-ok)',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <CheckCircle2 size={15} />
                <span>Video berhasil dirender! Siap diputar dan diunduh.</span>
              </div>

              {/* Vertical / Custom Aspect Video Player Frame */}
              <div
                style={{
                  width: aspectRatio === '9:16' ? '240px' : aspectRatio === '1:1' ? '320px' : '100%',
                  aspectRatio: aspectRatio.replace(':', '/'),
                  maxHeight: '360px',
                  backgroundColor: '#000000',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  border: '1px solid var(--border-medium)',
                  boxShadow: 'var(--shadow-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <video
                  src={renderedVideoUrl}
                  controls
                  autoPlay
                  loop
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                >
                  <track kind="captions" />
                </video>
              </div>

              {/* Download and Re-render actions */}
              <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setIsCompleted(false)}
                >
                  <RotateCcw size={14} />
                  Render Ulang
                </button>

                <button
                  id="btn-download-rendered-mp4"
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 2 }}
                  onClick={handleDownload}
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Download size={14} />
                  )}
                  {isDownloading ? 'Mengunduh...' : 'Unduh Video MP4'}
                </button>
              </div>
            </div>
          ) : (
            /* 3. Settings Configuration Form */
            <>
              {/* Option 1: Aspect Ratio */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 8 }}>
                  1. Rasio Aspek Video
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setAspectRatio('9:16')}
                    style={{
                      padding: '12px 10px',
                      backgroundColor: aspectRatio === '9:16' ? 'var(--bg-surface-elevated)' : 'var(--bg-app)',
                      border: aspectRatio === '9:16' ? '1.5px solid var(--accent-neutral)' : '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Smartphone size={20} color={aspectRatio === '9:16' ? 'var(--accent-neutral)' : 'var(--text-muted)'} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>9:16 Vertikal</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Shorts / TikTok</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAspectRatio('1:1')}
                    style={{
                      padding: '12px 10px',
                      backgroundColor: aspectRatio === '1:1' ? 'var(--bg-surface-elevated)' : 'var(--bg-app)',
                      border: aspectRatio === '1:1' ? '1.5px solid var(--accent-neutral)' : '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Square size={20} color={aspectRatio === '1:1' ? 'var(--accent-neutral)' : 'var(--text-muted)'} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>1:1 Persegi</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Instagram Feed</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAspectRatio('16:9')}
                    style={{
                      padding: '12px 10px',
                      backgroundColor: aspectRatio === '16:9' ? 'var(--bg-surface-elevated)' : 'var(--bg-app)',
                      border: aspectRatio === '16:9' ? '1.5px solid var(--accent-neutral)' : '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Monitor size={20} color={aspectRatio === '16:9' ? 'var(--accent-neutral)' : 'var(--text-muted)'} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>16:9 Asli</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>YouTube Horizontal</span>
                  </button>
                </div>
              </div>

              {/* Option 2: Crop Mode (only relevant for 9:16 or 1:1) */}
              {aspectRatio !== '16:9' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                      2. Gaya Tampilan / Cropping
                    </label>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>4 Mode Tata Letak</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                    {[
                      {
                        id: 'blur_fill',
                        label: 'Blur Background Fill',
                        desc: 'Latar blur aman untuk video podcast horizontal',
                      },
                      {
                        id: 'center_crop',
                        label: 'Center Crop',
                        desc: 'Potong tengah 9:16 layar vertikal penuh',
                      },
                      {
                        id: 'framed_headline',
                        label: 'Framed Headline',
                        desc: '16:9 di tengah + banner hook judul atas',
                      },
                      {
                        id: 'speaker_track',
                        label: 'Speaker Track (AI Switch)',
                        desc: 'Fokus bergilir orang berbicara (podcast 2 orang)',
                      },
                    ].map((item) => {
                      const isSelected = cropMode === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          id={`modal-crop-option-${item.id}`}
                          onClick={() => setCropMode(item.id as CropMode)}
                          style={{
                            padding: '10px 12px',
                            backgroundColor: isSelected ? 'var(--bg-surface-elevated)' : 'var(--bg-app)',
                            border: isSelected ? '1.5px solid var(--accent-neutral)' : '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <div style={{ fontSize: 11.5, fontWeight: 600, color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                            {item.label}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                            {item.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Option 3: Subtitle Style */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    3. Gaya Burn-in Subtitle
                  </label>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>6 Tipografi Viral ASS</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {[
                    {
                      id: 'condensed_clean',
                      label: 'Condensed Clean',
                      preview: 'Aa Clean',
                      font: 'Bahnschrift',
                      color: '#ffffff',
                      desc: 'Bahnschrift putih outline hitam',
                    },
                    {
                      id: 'hormozi',
                      label: 'Hormozi Gold',
                      preview: 'HORMOZI',
                      font: 'Impact',
                      color: '#ffe500',
                      desc: 'Impact kapital emas + shadow',
                    },
                    {
                      id: 'boxed_vox',
                      label: 'Boxed Vox',
                      preview: '[ Vox Box ]',
                      font: 'Segoe UI Black',
                      color: '#ffffff',
                      boxBg: 'rgba(20,20,20,0.75)',
                      desc: 'Segoe UI Black kotak gelap',
                    },
                    {
                      id: 'cyber_neon',
                      label: 'Cyber Neon',
                      preview: 'CYBER',
                      font: 'Impact',
                      color: '#00ffff',
                      glow: '0 0 6px #d000a0',
                      desc: 'Cyan outline Magenta tebal',
                    },
                    {
                      id: 'word_highlight',
                      label: 'Word Highlight',
                      preview: 'WORD GLOW',
                      font: 'Impact',
                      color: '#ffe500',
                      glow: '0 0 5px rgba(255,229,0,0.8)',
                      desc: 'Karaoke nyala emas dinamis',
                    },
                    {
                      id: 'none',
                      label: 'Tanpa Subtitle',
                      preview: '—',
                      font: 'inherit',
                      color: 'var(--text-muted)',
                      desc: 'Hanya video murni tanpa teks',
                    },
                  ].map((item) => {
                    const isSelected = subtitleStyle === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        id={`modal-subtitle-option-${item.id}`}
                        onClick={() => setSubtitleStyle(item.id as SubtitleStyle)}
                        style={{
                          padding: '8px 10px',
                          backgroundColor: isSelected ? 'var(--bg-surface-elevated)' : 'var(--bg-app)',
                          border: isSelected ? '1.5px solid var(--accent-neutral)' : '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                            {item.label}
                          </span>
                          <span
                            style={{
                              fontSize: 9.5,
                              fontFamily: item.font,
                              fontWeight: 700,
                              color: item.color,
                              backgroundColor: item.boxBg || 'transparent',
                              padding: item.boxBg ? '1px 3px' : '0',
                              borderRadius: 2,
                              textShadow: item.glow || 'none',
                            }}
                          >
                            {item.preview}
                          </span>
                        </div>
                        <div style={{ fontSize: 9.5, color: 'var(--text-muted)', lineHeight: 1.25 }}>
                          {item.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Option 4: Dynamic Auto-Zoom Retention Engine */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    4. Dynamic Auto-Zoom (Retention Engine)
                  </label>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>3 Pola Kamera Teruji</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {[
                    { id: 'none', label: 'Tanpa Zoom', badge: '1.0x', desc: '1.0x Statis murni' },
                    { id: 'subtle', label: 'Subtle Breathing', badge: '1.12x', desc: 'Siklus nafas halus' },
                    { id: 'snap_hook', label: 'Snap Hook', badge: 'Hook 1.20x', desc: '1.20x punchy di 3 detik awal' },
                  ].map((item) => {
                    const isSelected = autoZoom === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        id={`modal-zoom-option-${item.id}`}
                        onClick={() => setAutoZoom(item.id as AutoZoom)}
                        style={{
                          padding: '8px 10px',
                          backgroundColor: isSelected ? 'var(--bg-surface-elevated)' : 'var(--bg-app)',
                          border: isSelected ? '1.5px solid var(--accent-neutral)' : '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                            {item.label}
                          </span>
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 600,
                              padding: '1px 3px',
                              borderRadius: 3,
                              backgroundColor: isSelected ? 'var(--bg-app)' : 'var(--bg-surface)',
                              color: isSelected ? 'var(--accent-neutral)' : 'var(--text-muted)',
                            }}
                          >
                            {item.badge}
                          </span>
                        </div>
                        <div style={{ fontSize: 9.5, color: 'var(--text-muted)', lineHeight: 1.25 }}>
                          {item.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* CTA Button */}
              <button
                id="btn-confirm-render-mp4"
                type="button"
                className="btn btn-primary btn-full"
                style={{ height: '38px', marginTop: 8 }}
                onClick={handleStartRender}
              >
                <Sparkles size={15} />
                Mulai Render MP4
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
