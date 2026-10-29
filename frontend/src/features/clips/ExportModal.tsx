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
  RectangleVertical,
  Monitor,
  Sparkles,
  RotateCcw,
  Music,
  Archive,
} from 'lucide-react';
import type {
  AspectRatio,
  AutoZoom,
  ClipCandidate,
  CropMode,
  SubtitleStyle,
} from '../../types/clip';
import {
  downloadExportKit,
  downloadRenderedClip,
  getRenderedClipStreamUrl,
  triggerRenderClip,
  updateClip,
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
  if (
    mode === 'center_crop' ||
    mode === 'framed_headline' ||
    mode === 'speaker_track' ||
    mode === 'streamer_split'
  ) return mode;
  return 'blur_fill';
};

const normalizeAutoZoom = (zoom?: string): AutoZoom => {
  if (zoom === 'snap_hook' || zoom === 'none' || zoom === 'jump_cut') return zoom as AutoZoom;
  return 'snap_hook';
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
  const [introHookBanner, setIntroHookBanner] = useState<boolean>(clip.intro_hook_banner !== false);
  const [bgmTrackId, setBgmTrackId] = useState<string | null>(clip.bgm_track_id || null);
  const [bgmVolume, setBgmVolume] = useState<number>(
    clip.bgm_volume != null ? Math.round(clip.bgm_volume * 100) : 18
  );

  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [isCompleted, setIsCompleted] = useState(
    clip.render_status === 'completed' && Boolean(clip.rendered_file_path)
  );
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadingKit, setIsDownloadingKit] = useState(false);

  const handleDownloadKit = async () => {
    setIsDownloadingKit(true);
    try {
      await downloadExportKit(
        clip.id,
        `${clip.title ? clip.title.replace(/[^a-zA-Z0-9_-]/g, '_') : 'clip'}_export_kit.zip`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengunduh publishing kit.';
      setError(msg);
    } finally {
      setIsDownloadingKit(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setAspectRatio(clip.aspect_ratio || '9:16');
      setCropMode(normalizeCropMode(clip.crop_mode));
      setSubtitleStyle(normalizeSubtitleStyle(clip.subtitle_style));
      setAutoZoom(normalizeAutoZoom(clip.auto_zoom));
      setIntroHookBanner(clip.intro_hook_banner !== false);
      setBgmTrackId(clip.bgm_track_id || null);
      setBgmVolume(clip.bgm_volume != null ? Math.round(clip.bgm_volume * 100) : 18);
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
      // Persist latest configuration to database prior to triggering render job
      await updateClip(clip.id, {
        aspect_ratio: aspectRatio,
        crop_mode: cropMode,
        subtitle_style: subtitleStyle,
        auto_zoom: autoZoom,
        intro_hook_banner: introHookBanner,
        show_hook_banner: introHookBanner,
        crop_x_pct: clip.crop_x_pct ?? 0.50,
        remove_silence: clip.remove_silence ?? false,
        auto_emoji: clip.auto_emoji ?? true,
        bgm_track_id: bgmTrackId ?? undefined,
        bgm_volume: Number((bgmVolume / 100).toFixed(2)),
        soundboard_cues_json: clip.soundboard_cues_json,
      });

      const res = await triggerRenderClip(clip.id, {
        aspect_ratio: aspectRatio,
        crop_x_pct: clip.crop_x_pct ?? 0.50,
        remove_silence: clip.remove_silence ?? false,
        auto_emoji: clip.auto_emoji ?? true,
        crop_mode: cropMode,
        subtitle_style: subtitleStyle,
        auto_zoom: autoZoom,
        intro_hook_banner: introHookBanner,
        show_hook_banner: introHookBanner,
        bgm_track_id: bgmTrackId,
        bgm_volume: Number((bgmVolume / 100).toFixed(2)),
        soundboard_cues_json: clip.soundboard_cues_json,
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
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
                    className="btn btn-secondary"
                    style={{ flex: 1.5 }}
                    onClick={handleDownload}
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    {isDownloading ? 'Mengunduh...' : 'Unduh MP4'}
                  </button>
                </div>

                <button
                  id="btn-download-export-kit-modal"
                  type="button"
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    backgroundColor: '#10b981',
                    border: 'none',
                    color: '#ffffff',
                    fontWeight: 600,
                  }}
                  onClick={handleDownloadKit}
                  disabled={isDownloadingKit}
                  title="Unduh Video MP4 + Cover JPG + Teks Copywriting TXT dalam 1 arsip .zip"
                >
                  {isDownloadingKit ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Archive size={14} />
                  )}
                  {isDownloadingKit ? 'Mengompresi Kit ZIP...' : 'Unduh Paket Lengkap 1-Click Kit (.zip)'}
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setAspectRatio('9:16')}
                    style={{
                      padding: '12px 8px',
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
                    <Smartphone size={18} color={aspectRatio === '9:16' ? 'var(--accent-neutral)' : 'var(--text-muted)'} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)' }}>9:16 Vertikal</span>
                    <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Shorts / TikTok</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAspectRatio('1:1')}
                    style={{
                      padding: '12px 8px',
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
                    <Square size={18} color={aspectRatio === '1:1' ? 'var(--accent-neutral)' : 'var(--text-muted)'} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)' }}>1:1 Persegi</span>
                    <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Feed Square</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAspectRatio('4:5')}
                    style={{
                      padding: '12px 8px',
                      backgroundColor: aspectRatio === '4:5' ? 'var(--bg-surface-elevated)' : 'var(--bg-app)',
                      border: aspectRatio === '4:5' ? '1.5px solid var(--accent-neutral)' : '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <RectangleVertical size={18} color={aspectRatio === '4:5' ? 'var(--accent-neutral)' : 'var(--text-muted)'} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)' }}>4:5 Portrait</span>
                    <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>IG Portrait</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAspectRatio('16:9')}
                    style={{
                      padding: '12px 8px',
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
                    <Monitor size={18} color={aspectRatio === '16:9' ? 'var(--accent-neutral)' : 'var(--text-muted)'} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)' }}>16:9 Asli</span>
                    <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>YT Landscape</span>
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
                      {
                        id: 'streamer_split',
                        label: 'Streamer Split (Facecam + Game)',
                        desc: 'Facecam streamer di atas, layar game di bawah',
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
                    { id: 'snap_hook', label: 'Jump-Cut Pacing (FYP)', badge: '1.20x Cut', desc: 'Hard cut modular 1.20x tiap 5 detik' },
                    { id: 'subtle', label: 'Subtle Pacing', badge: '1.12x Cut', desc: 'Jump-cut ritmik lebih halus' },
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

              {/* Option 5: Intro Hook Banner (Detik 0–3) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  backgroundColor: 'var(--bg-app)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                    5. Tampilkan Hook Banner Awal (Detik 0–3)
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    Kotak judul hook tebal di 3 detik pertama video untuk retensi FYP
                  </div>
                </div>
                <button
                  type="button"
                  id="modal-toggle-intro-hook-banner"
                  onClick={() => setIntroHookBanner(!introHookBanner)}
                  style={{
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: introHookBanner ? '#facc15' : 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    position: 'relative',
                    padding: 2,
                    transition: 'all 0.2s',
                  }}
                  title={introHookBanner ? 'Matikan Banner Hook Awal' : 'Aktifkan Banner Hook Awal'}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      backgroundColor: introHookBanner ? '#000000' : 'var(--text-muted)',
                      transform: introHookBanner ? 'translateX(16px)' : 'translateX(0)',
                      transition: 'transform 0.2s',
                    }}
                  />
                </button>
              </div>

              {/* Option 6: Background Music & Speech Auto-Ducking */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Music size={13} color="#a1a1aa" />
                    6. Musik Latar & Speech Auto-Ducking
                  </label>
                  <span
                    style={{
                      fontSize: 9.5,
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-pill)',
                      backgroundColor: 'rgba(59, 130, 246, 0.12)',
                      color: '#60a5fa',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      fontWeight: 600,
                    }}
                  >
                    Sidechain FFmpeg
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {[
                    { id: null, label: 'Tanpa Musik', desc: 'Hanya vokal asli' },
                    { id: 'lofi_chill', label: 'Lo-Fi Chill', desc: 'Warm acoustic pad' },
                    { id: 'comedy_quirky', label: 'Comedy Quirky', desc: 'Beat ritmis komedi' },
                    { id: 'suspense_tension', label: 'Suspense Drone', desc: 'Dramatic tension' },
                  ].map((track) => {
                    const isSelected = bgmTrackId === track.id;
                    return (
                      <button
                        key={track.id || 'none'}
                        type="button"
                        id={`modal-bgm-option-${track.id || 'none'}`}
                        onClick={() => setBgmTrackId(track.id)}
                        style={{
                          padding: '8px 6px',
                          backgroundColor: isSelected ? 'var(--bg-surface-elevated)' : 'var(--bg-app)',
                          border: isSelected ? '1.5px solid var(--accent-neutral)' : '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          textAlign: 'center',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 2,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 600,
                            color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                          }}
                        >
                          {track.label}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.2 }}>
                          {track.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {bgmTrackId && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: '8px 10px',
                      backgroundColor: 'var(--bg-app)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Volume Musik Latar:</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{bgmVolume}%</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={40}
                      step={1}
                      value={bgmVolume}
                      onChange={(e) => setBgmVolume(Number(e.target.value))}
                      style={{
                        width: '100%',
                        accentColor: 'var(--accent-neutral)',
                        cursor: 'pointer',
                        height: 4,
                      }}
                    />
                    <div style={{ fontSize: 9.5, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span>⚡</span>
                      <span>Auto-Ducking: Musik otomatis surut (-20 dB) saat suara orang berbicara.</span>
                    </div>
                  </div>
                )}
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
