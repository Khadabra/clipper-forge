/**
 * features/clips/ClipEditorStudio.tsx — Interactive Studio Editor & Retention Engine.
 *
 * Clean Zinc Workstation UI (#09090b, border #27272a).
 * Features:
 * - Tab Toggle: [Mode Edit & Preview] vs [Lihat Hasil MP4]
 * - Live Interactive WYSIWYG Preview:
 *   * 'framed_headline': Header hook banner + centered 16:9 video + black padding
 *   * 'center_crop': 9:16 vertical full frame with object-fit cover
 *   * 'blur_fill': Foreground video centered with synchronized real-time blurred background
 * - Live Real-Time Subtitle Overlay:
 *   * 'hormozi': Impact font, uppercase, golden yellow #FFE500, heavy black outline
 *   * 'condensed_clean': Bahnschrift font, sleek condensed white text, sharp outline
 *   * 'boxed_vox': Segoe UI Black font with dark translucent box container
 *   * 'cyber_neon': Impact font, cyan text with hot magenta neon glow
 *   * 'word_highlight': Real-time active word karaoke highlight in golden yellow
 *   * 'none': Clean video without subtitle overlay
 * - Curated Retention Auto-Zoom: None, Subtle (1.12x), Snap Hook (1.20x 3s)
 * - Visual Trim Bar & Subtitle Inline Editor
 */
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import {
  X,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Scissors,
  Type,
  Film,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Layout,
  Layers,
} from 'lucide-react';
import type {
  AspectRatio,
  AutoZoom,
  ClipCandidate,
  ClipSubtitleSegment,
  CropMode,
  SubtitleStyle,
} from '../../types/clip';
import {
  downloadRenderedClip,
  fetchClipTranscript,
  getRenderedClipStreamUrl,
  triggerRenderClip,
  updateClip,
  updateClipTranscript,
} from '../../services/clipsApi';
import { subscribeJobEvents } from '../../services/jobsApi';

interface Props {
  clip: ClipCandidate;
  isOpen: boolean;
  onClose: () => void;
  onClipUpdated?: (clip: ClipCandidate) => void;
  onClipRendered?: (clipId: string) => void;
  videoSourceUrl?: string;
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

export const ClipEditorStudio: React.FC<Props> = ({
  clip,
  isOpen,
  onClose,
  onClipUpdated,
  onClipRendered,
  videoSourceUrl,
}) => {
  // Trim state
  const [trimStart, setTrimStart] = useState<number>(clip.start_time);
  const [trimEnd, setTrimEnd] = useState<number>(clip.end_time);

  // Styling & Engine state
  const [autoZoom, setAutoZoom] = useState<AutoZoom>(normalizeAutoZoom(clip.auto_zoom));
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(clip.aspect_ratio || '9:16');
  const [cropMode, setCropMode] = useState<CropMode>(normalizeCropMode(clip.crop_mode));
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(normalizeSubtitleStyle(clip.subtitle_style));

  // Preview Mode Tab state: 'edit' (WYSIWYG) or 'rendered' (MP4 playback)
  const [previewTab, setPreviewTab] = useState<'edit' | 'rendered'>(
    clip.render_status === 'completed' && Boolean(clip.rendered_file_path) ? 'rendered' : 'edit'
  );

  // Subtitle editor state
  const [segments, setSegments] = useState<ClipSubtitleSegment[]>([]);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  // Player preview state
  const videoRef = useRef<HTMLVideoElement>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPlayTime, setCurrentPlayTime] = useState(clip.start_time);

  // Saving & Rendering state
  const [isSaving, setIsSaving] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isCompleted, setIsCompleted] = useState(
    clip.render_status === 'completed' && Boolean(clip.rendered_file_path)
  );
  const [isDownloading, setIsDownloading] = useState(false);

  const duration = Math.max(0, trimEnd - trimStart);
  const sourceUrl =
    videoSourceUrl ||
    `${import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'}/storage/projects/${clip.project_id}/source.mp4`;
  const renderedVideoUrl = getRenderedClipStreamUrl(clip.project_id, clip.id);

  // Format seconds to mm:ss.ms
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  // 1. Initialize studio data when opened
  useEffect(() => {
    if (isOpen) {
      setTrimStart(clip.start_time);
      setTrimEnd(clip.end_time);
      setAutoZoom(normalizeAutoZoom(clip.auto_zoom));
      setAspectRatio(clip.aspect_ratio || '9:16');
      setCropMode(normalizeCropMode(clip.crop_mode));
      setSubtitleStyle(normalizeSubtitleStyle(clip.subtitle_style));
      const completed = clip.render_status === 'completed' && Boolean(clip.rendered_file_path);
      setIsCompleted(completed);
      setPreviewTab(completed ? 'rendered' : 'edit');
      setError(null);
      setIsPlaying(false);

      // Load segments for editing
      setIsLoadingTranscript(true);
      fetchClipTranscript(clip.id)
        .then((data) => {
          setSegments(data);
          setIsLoadingTranscript(false);
        })
        .catch((err) => {
          setTranscriptError(err.message || 'Gagal memuat teks transkrip.');
          setIsLoadingTranscript(false);
        });
    }
  }, [isOpen, clip]);

  // 2. Enforce bounded loop preview in the player
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const cur = videoRef.current.currentTime;
      setCurrentPlayTime(cur);

      if (bgVideoRef.current && Math.abs(bgVideoRef.current.currentTime - cur) > 0.3) {
        bgVideoRef.current.currentTime = cur;
      }

      if (cur >= trimEnd) {
        videoRef.current.currentTime = trimStart;
        if (bgVideoRef.current) bgVideoRef.current.currentTime = trimStart;
        videoRef.current.play().catch(() => {});
        if (bgVideoRef.current) bgVideoRef.current.play().catch(() => {});
      } else if (cur < trimStart - 0.5) {
        videoRef.current.currentTime = trimStart;
        if (bgVideoRef.current) bgVideoRef.current.currentTime = trimStart;
      }
    }
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      if (bgVideoRef.current) bgVideoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (videoRef.current.currentTime < trimStart || videoRef.current.currentTime >= trimEnd) {
        videoRef.current.currentTime = trimStart;
        if (bgVideoRef.current) bgVideoRef.current.currentTime = trimStart;
      }
      videoRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
          if (bgVideoRef.current) bgVideoRef.current.play().catch(() => {});
        })
        .catch(() => {});
    }
  };

  // Subtitle sentence edit handler
  const handleSegmentTextChange = (index: number, newText: string) => {
    setSegments((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], text: newText };
      return updated;
    });
  };

  // Add new subtitle sentence
  const handleAddSegment = () => {
    const lastSeg = segments[segments.length - 1];
    const newStart = lastSeg ? Math.min(trimEnd - 0.5, lastSeg.end_time) : trimStart;
    const newEnd = Math.min(trimEnd, newStart + 2.0);
    const newSegment: ClipSubtitleSegment = {
      start_time: Number(newStart.toFixed(2)),
      end_time: Number(newEnd.toFixed(2)),
      text: 'Ketik kalimat subtitle baru...',
      speaker_label: segments.length % 2 === 1 ? 'Speaker B' : 'Speaker A',
    };
    setSegments((prev) => [...prev, newSegment]);
  };

  // Remove segment
  const handleRemoveSegment = (index: number) => {
    setSegments((prev) => prev.filter((_, i) => i !== index));
  };

  // Toggle speaker label for a segment (Speaker A vs Speaker B)
  const handleToggleSpeaker = (index: number) => {
    setSegments((prev) =>
      prev.map((seg, i) => {
        if (i !== index) return seg;
        const current = seg.speaker_label || (i % 2 === 1 ? 'Speaker B' : 'Speaker A');
        const nextSpeaker = current === 'Speaker B' ? 'Speaker A' : 'Speaker B';
        return { ...seg, speaker_label: nextSpeaker };
      })
    );
  };

  // Determine active speaker for live preview in Speaker Track mode
  const getActiveSpeakerForTime = (time: number): 'Speaker A' | 'Speaker B' => {
    const active = segments.find((s) => time >= s.start_time && time <= s.end_time);
    if (active) {
      if (active.speaker_label) {
        const l = active.speaker_label.toLowerCase();
        if (l.includes('b') || l.includes('2') || l.includes('kanan') || l.includes('right')) {
          return 'Speaker B';
        }
        return 'Speaker A';
      }
      const idx = segments.indexOf(active);
      return idx % 2 === 1 ? 'Speaker B' : 'Speaker A';
    }
    return 'Speaker A';
  };

  const activeSpeakerFocus = getActiveSpeakerForTime(currentPlayTime);

  // Save changes only (without render)
  const handleSaveOnly = async (): Promise<ClipCandidate | null> => {
    if (trimEnd <= trimStart) {
      setError('Waktu selesai harus lebih besar dari waktu mulai.');
      return null;
    }
    setError(null);
    setIsSaving(true);
    try {
      // 1. Update trim & settings on clip
      await updateClip(clip.id, {
        start_time: Number(trimStart.toFixed(2)),
        end_time: Number(trimEnd.toFixed(2)),
        aspect_ratio: aspectRatio,
        crop_mode: cropMode,
        subtitle_style: subtitleStyle,
        auto_zoom: autoZoom,
      });

      // 2. Save custom transcript segments if modified
      const validSegments = segments.filter(
        (s) => s.text.trim().length > 0 && s.end_time > s.start_time
      );
      const withTranscript = await updateClipTranscript(clip.id, validSegments);

      onClipUpdated?.(withTranscript);
      return withTranscript;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan perubahan studio.';
      setError(msg);
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  // Save & Render MP4 with real-time SSE progress
  const handleSaveAndRender = async () => {
    const saved = await handleSaveOnly();
    if (!saved) return;

    setError(null);
    setIsRendering(true);
    setRenderProgress(10);
    setRenderStage('Menyiapkan filtergraph, audio, dan dynamic zoom...');

    try {
      const res = await triggerRenderClip(clip.id, {
        aspect_ratio: aspectRatio,
        crop_mode: cropMode,
        subtitle_style: subtitleStyle,
        auto_zoom: autoZoom,
      });

      const cleanup = subscribeJobEvents(
        res.job_id,
        (job) => {
          setRenderProgress(job.progress);

          if (job.progress >= 20 && job.progress < 50) {
            setRenderStage('Memotong durasi & membuat subtitle ASS viral...');
          } else if (job.progress >= 50 && job.progress < 85) {
            setRenderStage(
              `Rendering filter ${autoZoom !== 'none' ? 'Auto-Zoom & ' : ''}encoding MP4...`
            );
          } else if (job.progress >= 85) {
            setRenderStage('Menyelesaikan file MP4 final...');
          }

          if (job.status === 'completed') {
            setIsRendering(false);
            setIsCompleted(true);
            setPreviewTab('rendered');
            onClipRendered?.(clip.id);
            cleanup();
          } else if (job.status === 'failed') {
            setIsRendering(false);
            setError(job.error_message || 'Render klip video gagal.');
            cleanup();
          }
        },
        () => {
          setIsRendering(false);
          setError('Koneksi status render terputus.');
        }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memulai render klip.';
      setError(msg);
      setIsRendering(false);
    }
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await downloadRenderedClip(
        clip.id,
        `clip_${clip.id.slice(0, 8)}_${cropMode}_${subtitleStyle}.mp4`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengunduh video.';
      setError(msg);
    } finally {
      setIsDownloading(false);
    }
  };

  // Live Real-Time Subtitle Overlay Renderer
  const renderLiveSubtitleOverlay = () => {
    const active =
      segments.find((s) => currentPlayTime >= s.start_time && currentPlayTime <= s.end_time) ||
      segments[0];

    if (!active || !active.text.trim()) return null;

    if (subtitleStyle === 'hormozi') {
      return (
        <span
          style={{
            fontFamily: "'Impact', 'Arial Black', sans-serif",
            fontWeight: 900,
            fontSize: 18,
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            color: '#FFE500',
            textShadow:
              '3px 3px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 0 4px 10px rgba(0,0,0,0.95)',
            lineHeight: 1.25,
            display: 'inline-block',
          }}
        >
          {active.text}
        </span>
      );
    }

    if (subtitleStyle === 'condensed_clean') {
      return (
        <span
          style={{
            fontFamily: "'Bahnschrift', 'Arial Bold', sans-serif",
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: '0.4px',
            color: '#ffffff',
            textShadow:
              '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 2px 6px rgba(0,0,0,0.85)',
            lineHeight: 1.3,
            display: 'inline-block',
          }}
        >
          {active.text}
        </span>
      );
    }

    if (subtitleStyle === 'boxed_vox') {
      return (
        <span
          style={{
            fontFamily: "'Segoe UI Black', 'Segoe UI', 'Arial Black', sans-serif",
            fontWeight: 800,
            fontSize: 14,
            color: '#ffffff',
            backgroundColor: 'rgba(18, 18, 20, 0.9)',
            padding: '4px 10px',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
            lineHeight: 1.3,
            display: 'inline-block',
          }}
        >
          {active.text}
        </span>
      );
    }

    if (subtitleStyle === 'cyber_neon') {
      return (
        <span
          style={{
            fontFamily: "'Impact', 'Arial Black', sans-serif",
            fontWeight: 900,
            fontSize: 17,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            color: '#00FFFF',
            textShadow:
              '0 0 8px #D000A0, 0 0 16px #D000A0, 2px 2px 0 #600050, -2px -2px 0 #600050',
            lineHeight: 1.25,
            display: 'inline-block',
          }}
        >
          {active.text}
        </span>
      );
    }

    if (subtitleStyle === 'word_highlight') {
      const tokens = active.text.trim().split(/\s+/);
      const segDur = Math.max(0.1, active.end_time - active.start_time);
      const progress = Math.max(0, Math.min(1, (currentPlayTime - active.start_time) / segDur));
      const activeWordIdx = Math.min(tokens.length - 1, Math.floor(progress * tokens.length));

      return (
        <span
          style={{
            fontFamily: "'Impact', 'Arial Black', sans-serif",
            fontWeight: 900,
            fontSize: 17,
            textTransform: 'uppercase',
            textShadow:
              '2.5px 2.5px 0 #000, -2.5px -2.5px 0 #000, 2.5px -2.5px 0 #000, -2.5px 2.5px 0 #000, 0 4px 8px rgba(0,0,0,0.9)',
            lineHeight: 1.25,
            display: 'inline-flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '5px',
          }}
        >
          {tokens.map((token, idx) => {
            const isWordActive = idx === activeWordIdx;
            return (
              <span
                key={`${active.start_time}-${token}-${idx}`}
                style={{
                  color: isWordActive ? '#FFE500' : '#ffffff',
                  transform: isWordActive ? 'scale(1.14)' : 'scale(1)',
                  transition: 'all 0.08s ease',
                  display: 'inline-block',
                }}
              >
                {token}
              </span>
            );
          })}
        </span>
      );
    }

    return null;
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(6px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        id="clip-editor-studio-modal"
        style={{
          backgroundColor: '#09090b',
          border: '1px solid #27272a',
          borderRadius: 10,
          width: '100%',
          maxWidth: '1060px',
          height: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
          overflow: 'hidden',
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid #27272a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#121214',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                backgroundColor: '#18181b',
                border: '1px solid #27272a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#e4e4e7',
              }}
            >
              <Scissors size={15} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#f4f4f5' }}>
                  Clip Studio Editor
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: 4,
                    backgroundColor: '#18181b',
                    border: '1px solid #27272a',
                    color: '#a1a1aa',
                  }}
                >
                  Retention Engine 2.0
                </span>
              </div>
              <p style={{ fontSize: 11, color: '#71717a', margin: 0, marginTop: 2 }}>
                {clip.title} • Durasi: {duration.toFixed(1)}s
              </p>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '6px', color: '#71717a', borderRadius: 6 }}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Studio Body: Two Columns */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(330px, 420px) 1fr',
            flex: 1,
            overflow: 'hidden',
          }}
        >
          {/* Left Column: Video Preview & Visual Trim Bar */}
          <div
            style={{
              padding: '16px',
              borderRight: '1px solid #27272a',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overflowY: 'auto',
              backgroundColor: '#0c0c0e',
            }}
          >
            {/* Preview Mode Tab Switcher */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px',
                backgroundColor: '#121214',
                borderRadius: 6,
                border: '1px solid #27272a',
              }}
            >
              <button
                type="button"
                id="btn-tab-preview-edit"
                onClick={() => setPreviewTab('edit')}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: 4,
                  border: 'none',
                  backgroundColor: previewTab === 'edit' ? '#18181b' : 'transparent',
                  color: previewTab === 'edit' ? '#f4f4f5' : '#71717a',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'all 0.15s ease',
                }}
              >
                <Film size={12} />
                Mode Edit & Preview
              </button>

              <button
                type="button"
                id="btn-tab-preview-rendered"
                onClick={() => setPreviewTab('rendered')}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: 4,
                  border: 'none',
                  backgroundColor: previewTab === 'rendered' ? '#18181b' : 'transparent',
                  color: previewTab === 'rendered' ? '#f4f4f5' : '#71717a',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'all 0.15s ease',
                  opacity: isCompleted ? 1 : 0.6,
                }}
                title={isCompleted ? 'Tonton video hasil render MP4' : 'Render video terlebih dahulu'}
              >
                <CheckCircle2 size={12} color={isCompleted ? '#22c55e' : '#71717a'} />
                Lihat Hasil MP4
                {isCompleted && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: '#22c55e',
                      display: 'inline-block',
                    }}
                  />
                )}
              </button>
            </div>

            {/* Live Interactive WYSIWYG Player Box */}
            {previewTab === 'edit' ? (
              <div
                style={{
                  position: 'relative',
                  borderRadius: 8,
                  overflow: 'hidden',
                  backgroundColor: '#000000',
                  border: '1px solid #27272a',
                  aspectRatio: '9/16',
                  maxHeight: '380px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: cropMode === 'framed_headline' ? 'space-between' : 'center',
                  margin: '0 auto',
                  width: '100%',
                }}
              >
                {/* 1. Framed Headline: Top Banner Container */}
                {cropMode === 'framed_headline' && (
                  <div
                    style={{
                      width: '100%',
                      backgroundColor: '#0a0a0c',
                      borderBottom: '1px solid #27272a',
                      padding: '8px 10px',
                      textAlign: 'center',
                      zIndex: 3,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Impact', 'Arial Black', sans-serif",
                        fontSize: 12,
                        letterSpacing: '0.5px',
                        color: '#ffffff',
                        textTransform: 'uppercase',
                        display: 'block',
                        lineHeight: 1.25,
                      }}
                    >
                      {clip.hook || clip.title}
                    </span>
                  </div>
                )}

                {/* 2. Video Stage with Simulated Blur or Cover Crop */}
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: cropMode === 'framed_headline' ? 'auto' : '100%',
                    aspectRatio: cropMode === 'framed_headline' ? '16/9' : undefined,
                    flex: cropMode === 'framed_headline' ? undefined : 1,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#000000',
                  }}
                >
                  {/* Blur Fill Simulated Background Video */}
                  {cropMode === 'blur_fill' && (
                    <video
                      ref={bgVideoRef}
                      src={sourceUrl}
                      preload="metadata"
                      muted
                      playsInline
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        filter: 'blur(16px) brightness(0.6)',
                        transform: 'scale(1.25)',
                        pointerEvents: 'none',
                        zIndex: 0,
                      }}
                    />
                  )}

                  {/* Main Video Stream */}
                  <video
                    ref={videoRef}
                    src={sourceUrl}
                    preload="metadata"
                    onTimeUpdate={handleTimeUpdate}
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      width: '100%',
                      height: '100%',
                      objectFit: cropMode === 'center_crop' || cropMode === 'speaker_track' ? 'cover' : 'contain',
                      objectPosition:
                        cropMode === 'speaker_track'
                          ? activeSpeakerFocus === 'Speaker B'
                            ? '75% center'
                            : '25% center'
                          : 'center',
                      transform:
                        autoZoom === 'snap_hook' && currentPlayTime - trimStart <= 3.0
                          ? 'scale(1.15)'
                          : 'scale(1.0)',
                      transition: 'object-position 0.25s ease-in-out, transform 0.2s ease',
                    }}
                  />
                </div>

                {/* Active Speaker Indicator Badge in Speaker Track Mode */}
                {cropMode === 'speaker_track' && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 10,
                      left: 10,
                      zIndex: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      backgroundColor: 'rgba(12, 12, 14, 0.88)',
                      border: '1px solid #3f3f46',
                      borderRadius: 16,
                      padding: '4px 10px',
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: activeSpeakerFocus === 'Speaker B' ? '#38bdf8' : '#eab308',
                      backdropFilter: 'blur(6px)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        backgroundColor: activeSpeakerFocus === 'Speaker B' ? '#38bdf8' : '#eab308',
                        boxShadow: `0 0 6px ${activeSpeakerFocus === 'Speaker B' ? '#38bdf8' : '#eab308'}`,
                      }}
                    />
                    <span>
                      {activeSpeakerFocus === 'Speaker B' ? 'Kamera: Penceramah 2 (Kanan)' : 'Kamera: Penceramah 1 (Kiri)'}
                    </span>
                  </div>
                )}

                {/* 3. Framed Headline: Bottom Black Padding */}
                {cropMode === 'framed_headline' && (
                  <div
                    style={{
                      width: '100%',
                      height: '36px',
                      backgroundColor: '#0a0a0c',
                      borderTop: '1px solid #1f1f23',
                    }}
                  />
                )}

                {/* Live Real-time Subtitle Overlay */}
                {subtitleStyle !== 'none' && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: cropMode === 'framed_headline' ? '24%' : '14%',
                      left: '6%',
                      right: '6%',
                      textAlign: 'center',
                      pointerEvents: 'none',
                      zIndex: 4,
                    }}
                  >
                    {renderLiveSubtitleOverlay()}
                  </div>
                )}

                {/* Play/Pause Overlay Button */}
                <button
                  type="button"
                  onClick={togglePlayPause}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    backgroundColor: 'rgba(24, 24, 27, 0.75)',
                    border: '1px solid #3f3f46',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    opacity: isPlaying ? 0 : 0.9,
                    transition: 'opacity 0.15s ease',
                    zIndex: 5,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = isPlaying ? '0' : '0.9')}
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
                </button>
              </div>
            ) : (
              /* Rendered MP4 Player View */
              <div
                style={{
                  position: 'relative',
                  borderRadius: 8,
                  overflow: 'hidden',
                  backgroundColor: '#000000',
                  border: '1px solid #27272a',
                  aspectRatio: '9/16',
                  maxHeight: '380px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto',
                  width: '100%',
                }}
              >
                {isCompleted ? (
                  <video
                    src={renderedVideoUrl}
                    controls
                    autoPlay
                    loop
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  >
                    <track kind="captions" />
                  </video>
                ) : (
                  <div style={{ textAlign: 'center', padding: 20, color: '#71717a' }}>
                    <Film size={28} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                    <p style={{ fontSize: 12, margin: 0 }}>Video belum dirender.</p>
                    <p style={{ fontSize: 10, margin: '4px 0 0', color: '#52525b' }}>
                      Klik "Simpan & Render MP4" untuk merender video.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Loop Preview Controls */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                backgroundColor: '#121214',
                borderRadius: 6,
                border: '1px solid #27272a',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className={isPlaying ? 'btn btn-secondary' : 'btn btn-ghost'}
                  style={{ fontSize: 11, padding: '4px 8px', height: 26 }}
                  onClick={togglePlayPause}
                >
                  {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                  {isPlaying ? 'Pause' : 'Loop Klip'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '4px 8px', height: 26, color: '#a1a1aa' }}
                  onClick={() => {
                    if (videoRef.current) {
                      videoRef.current.currentTime = trimStart;
                      if (bgVideoRef.current) bgVideoRef.current.currentTime = trimStart;
                      videoRef.current
                        .play()
                        .then(() => setIsPlaying(true))
                        .catch(() => {});
                      if (bgVideoRef.current) bgVideoRef.current.play().catch(() => {});
                    }
                  }}
                  title="Putar ulang dari detik mulai"
                >
                  <RotateCcw size={12} />
                  Restart
                </button>
              </div>

              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#a1a1aa' }}>
                {formatTime(currentPlayTime)} / {formatTime(trimEnd)}
              </span>
            </div>

            {/* Visual Trim Bar */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '12px',
                backgroundColor: '#121214',
                borderRadius: 6,
                border: '1px solid #27272a',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#f4f4f5' }}>
                  Visual Trim (Potong Durasi)
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: 4,
                    backgroundColor: '#18181b',
                    color: '#e4e4e7',
                  }}
                >
                  {duration.toFixed(2)}s
                </span>
              </div>

              {/* Range sliders */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 10,
                      color: '#71717a',
                      marginBottom: 2,
                    }}
                  >
                    <span>Mulai: {formatTime(trimStart)}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => {
                          const val = Math.max(0, trimStart - 0.5);
                          setTrimStart(val);
                          if (videoRef.current) videoRef.current.currentTime = val;
                        }}
                        style={{
                          background: '#18181b',
                          border: '1px solid #27272a',
                          color: '#a1a1aa',
                          borderRadius: 3,
                          padding: '1px 4px',
                          fontSize: 9,
                          cursor: 'pointer',
                        }}
                      >
                        -0.5s
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const val = Math.min(trimEnd - 1, trimStart + 0.5);
                          setTrimStart(val);
                          if (videoRef.current) videoRef.current.currentTime = val;
                        }}
                        style={{
                          background: '#18181b',
                          border: '1px solid #27272a',
                          color: '#a1a1aa',
                          borderRadius: 3,
                          padding: '1px 4px',
                          fontSize: 9,
                          cursor: 'pointer',
                        }}
                      >
                        +0.5s
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={trimEnd - 0.5}
                    step={0.1}
                    value={trimStart}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setTrimStart(val);
                      if (videoRef.current) videoRef.current.currentTime = val;
                    }}
                    style={{ width: '100%', accentColor: '#e4e4e7' }}
                  />
                </div>

                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 10,
                      color: '#71717a',
                      marginBottom: 2,
                    }}
                  >
                    <span>Selesai: {formatTime(trimEnd)}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => setTrimEnd((e) => Math.max(trimStart + 1, e - 0.5))}
                        style={{
                          background: '#18181b',
                          border: '1px solid #27272a',
                          color: '#a1a1aa',
                          borderRadius: 3,
                          padding: '1px 4px',
                          fontSize: 9,
                          cursor: 'pointer',
                        }}
                      >
                        -0.5s
                      </button>
                      <button
                        type="button"
                        onClick={() => setTrimEnd((e) => e + 0.5)}
                        style={{
                          background: '#18181b',
                          border: '1px solid #27272a',
                          color: '#a1a1aa',
                          borderRadius: 3,
                          padding: '1px 4px',
                          fontSize: 9,
                          cursor: 'pointer',
                        }}
                      >
                        +0.5s
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={trimStart + 0.5}
                    max={trimEnd + 30}
                    step={0.1}
                    value={trimEnd}
                    onChange={(e) => setTrimEnd(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#e4e4e7' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Engine Configurations & Subtitle Inline Editor */}
          <div
            style={{
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              overflowY: 'auto',
              backgroundColor: '#09090b',
            }}
          >
            {/* Dynamic Auto-Zoom Retention Engine Selector (3 Best Curated) */}
            <div
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 8,
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={14} color="#e4e4e7" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                    Dynamic Auto-Zoom Retention Engine
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: '#a1a1aa',
                    backgroundColor: '#18181b',
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: '1px solid #27272a',
                  }}
                >
                  3 Pola Terkurasi
                </span>
              </div>
              <p style={{ fontSize: 11, color: '#a1a1aa', margin: 0 }}>
                Pola punch-in kamera dinamis untuk mencegah drop retensi penonton ala Opus Clip & Alex Hormozi.
              </p>

              {/* 3 Auto-Zoom Patterns */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8,
                }}
              >
                {[
                  { id: 'none', label: 'Tanpa Zoom', badge: '1.0x', desc: 'Statis murni tanpa transisi kamera' },
                  { id: 'subtle', label: 'Subtle Zoom', badge: '1.12x', desc: 'Punch-in halus ritmik per 5 detik' },
                  { id: 'snap_hook', label: 'Snap Hook', badge: 'Hook 1.2x', desc: 'Jump-cut 3s awal, lalu snap kembali 1.0x' },
                ].map((item) => {
                  const isSelected = autoZoom === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      id={`zoom-option-${item.id}`}
                      onClick={() => setAutoZoom(item.id as AutoZoom)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: isSelected ? '1px solid #e4e4e7' : '1px solid #27272a',
                        backgroundColor: isSelected ? '#18181b' : 'transparent',
                        color: isSelected ? '#f4f4f5' : '#71717a',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600 }}>{item.label}</span>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 600,
                            padding: '1px 4px',
                            borderRadius: 3,
                            backgroundColor: isSelected ? '#27272a' : '#141416',
                            color: isSelected ? '#e4e4e7' : '#52525b',
                          }}
                        >
                          {item.badge}
                        </span>
                      </div>
                      <span style={{ fontSize: 9.5, color: isSelected ? '#a1a1aa' : '#52525b', lineHeight: 1.25 }}>
                        {item.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Layout Cropping Mode Selector (3 Best Curated) */}
            <div
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 8,
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Layout size={14} color="#e4e4e7" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                    Layout Cropping & Komposisi Frame
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: '#a1a1aa',
                    backgroundColor: '#18181b',
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: '1px solid #27272a',
                  }}
                >
                  4 Mode Terpilih
                </span>
              </div>
              <p style={{ fontSize: 11, color: '#a1a1aa', margin: 0 }}>
                Pilih tata letak visual optimal untuk format vertikal Shorts, Reels, dan TikTok.
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 8,
                }}
              >
                {[
                  { id: 'blur_fill', label: 'Blur Background Fill', desc: 'Latar blur dinamis podcast / video horizontal' },
                  { id: 'center_crop', label: 'Center Crop', desc: 'Potong tengah 9:16 vertikal layar penuh' },
                  { id: 'framed_headline', label: 'Framed Headline', desc: '16:9 di tengah + banner hook teks atas' },
                  { id: 'speaker_track', label: 'Speaker Track (AI Switch)', desc: 'Fokus bergilir orang berbicara (podcast 2 orang)', badge: 'Smart Cut' },
                ].map((item) => {
                  const isSelected = cropMode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      id={`crop-option-${item.id}`}
                      onClick={() => setCropMode(item.id as CropMode)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: isSelected ? '1px solid #e4e4e7' : '1px solid #27272a',
                        backgroundColor: isSelected ? '#18181b' : 'transparent',
                        color: isSelected ? '#f4f4f5' : '#71717a',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600 }}>{item.label}</span>
                        {'badge' in item && (
                          <span
                            style={{
                              fontSize: 8.5,
                              fontWeight: 700,
                              padding: '1px 4px',
                              borderRadius: 3,
                              backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.2)' : '#18181b',
                              color: isSelected ? '#38bdf8' : '#71717a',
                              border: isSelected ? '1px solid #38bdf8' : '1px solid #27272a',
                            }}
                          >
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 9.5, color: isSelected ? '#a1a1aa' : '#52525b', lineHeight: 1.25 }}>
                        {item.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Viral Subtitle Typography Presets */}
            <div
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 8,
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Layers size={14} color="#e4e4e7" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                    Tipografi Subtitle Viral Windows 11
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: '#a1a1aa',
                    backgroundColor: '#18181b',
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: '1px solid #27272a',
                  }}
                >
                  Live Interactive
                </span>
              </div>
              <p style={{ fontSize: 11, color: '#a1a1aa', margin: 0 }}>
                Pilihan tipografi video pendek profesional dengan rendering subtitle instan di preview.
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8,
                }}
              >
                {[
                  {
                    id: 'hormozi',
                    label: 'Hormozi',
                    preview: 'HORMOZI',
                    font: 'Impact',
                    color: '#FFE500',
                    desc: 'Impact kapital, kuning emas & outline tebal',
                  },
                  {
                    id: 'condensed_clean',
                    label: 'Condensed Clean',
                    preview: 'Bahnschrift',
                    font: 'Bahnschrift',
                    color: '#ffffff',
                    desc: 'Tinggi ramping, putih elegan ala Reels',
                  },
                  {
                    id: 'boxed_vox',
                    label: 'Boxed Vox',
                    preview: '[Segoe UI]',
                    font: 'Segoe UI Black',
                    color: '#ffffff',
                    boxBg: 'rgba(0,0,0,0.65)',
                    desc: 'Kotak hitam transparan dokumenter Vox',
                  },
                  {
                    id: 'cyber_neon',
                    label: 'Cyber Neon',
                    preview: 'CYBER NEON',
                    font: 'Impact',
                    color: '#00FFFF',
                    glow: '0 0 6px #d000a0',
                    desc: 'Teks cyan outline magenta gaming/tech',
                  },
                  {
                    id: 'word_highlight',
                    label: 'Word Highlight',
                    preview: 'KARAOKE',
                    font: 'Impact',
                    color: '#FFE500',
                    desc: 'Kata aktif menyala emas berirama suara',
                  },
                  {
                    id: 'none',
                    label: 'Tanpa Subtitle',
                    preview: '—',
                    font: 'sans-serif',
                    color: '#71717a',
                    desc: 'Video murni tanpa overlay subtitle',
                  },
                ].map((item) => {
                  const isSelected = subtitleStyle === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      id={`subtitle-option-${item.id}`}
                      onClick={() => setSubtitleStyle(item.id as SubtitleStyle)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: isSelected ? '1px solid #e4e4e7' : '1px solid #27272a',
                        backgroundColor: isSelected ? '#18181b' : 'transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: isSelected ? '#f4f4f5' : '#a1a1aa' }}>
                          {item.label}
                        </span>
                        <span
                          style={{
                            fontFamily: item.font,
                            fontSize: 9.5,
                            fontWeight: 800,
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
                      <span style={{ fontSize: 9.5, color: isSelected ? '#a1a1aa' : '#52525b', lineHeight: 1.25 }}>
                        {item.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Subtitle Inline Editor */}
            <div
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 8,
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                flex: 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Type size={14} color="#e4e4e7" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                    Subtitle Inline Editor (Koreksi Teks)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleAddSegment}
                  style={{
                    padding: '3px 8px',
                    fontSize: 11,
                    borderRadius: 4,
                    backgroundColor: '#18181b',
                    border: '1px solid #27272a',
                    color: '#e4e4e7',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Plus size={11} /> Tambah Baris
                </button>
              </div>

              {/* Segments List */}
              {isLoadingTranscript ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#71717a', padding: 20 }}>
                  <Loader2 size={16} className="spinner" />
                  <span style={{ fontSize: 12 }}>Memuat transkrip klip...</span>
                </div>
              ) : transcriptError ? (
                <div
                  style={{
                    fontSize: 12,
                    color: '#f87171',
                    padding: 12,
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: 6,
                  }}
                >
                  {transcriptError}
                </div>
              ) : segments.length === 0 ? (
                <div style={{ fontSize: 12, color: '#71717a', padding: 12, textAlign: 'center' }}>
                  Tidak ada kalimat dalam rentang waktu klip ini. Klik "Tambah Baris" untuk menambahkan subtitle manual.
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    maxHeight: '220px',
                    overflowY: 'auto',
                    paddingRight: 4,
                  }}
                >
                  {segments.map((seg, idx) => (
                    <div
                      key={seg.id || idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        backgroundColor: '#09090b',
                        padding: '5px 8px',
                        borderRadius: 6,
                        border: '1px solid #27272a',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: 'monospace',
                          color: '#71717a',
                          whiteSpace: 'nowrap',
                          minWidth: '70px',
                        }}
                      >
                        {formatTime(seg.start_time)}
                      </span>

                      {/* Speaker Assignment Toggle Badge */}
                      <button
                        type="button"
                        id={`btn-speaker-toggle-${idx}`}
                        onClick={() => handleToggleSpeaker(idx)}
                        style={{
                          padding: '2px 7px',
                          borderRadius: 4,
                          border: '1px solid',
                          borderColor:
                            (seg.speaker_label || (idx % 2 === 1 ? 'Speaker B' : 'Speaker A')) === 'Speaker B'
                              ? 'rgba(56, 189, 248, 0.4)'
                              : 'rgba(234, 179, 8, 0.4)',
                          backgroundColor:
                            (seg.speaker_label || (idx % 2 === 1 ? 'Speaker B' : 'Speaker A')) === 'Speaker B'
                              ? 'rgba(56, 189, 248, 0.1)'
                              : 'rgba(234, 179, 8, 0.1)',
                          color:
                            (seg.speaker_label || (idx % 2 === 1 ? 'Speaker B' : 'Speaker A')) === 'Speaker B'
                              ? '#38bdf8'
                              : '#eab308',
                          fontSize: 9.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          whiteSpace: 'nowrap',
                          transition: 'all 0.15s ease',
                        }}
                        title="Klik untuk menukar fokus kamera (Penceramah 1 / Kiri vs Penceramah 2 / Kanan)"
                      >
                        <span>
                          {(seg.speaker_label || (idx % 2 === 1 ? 'Speaker B' : 'Speaker A')) === 'Speaker B'
                            ? 'P2 (Kanan)'
                            : 'P1 (Kiri)'}
                        </span>
                      </button>

                      <input
                        type="text"
                        value={seg.text}
                        onChange={(e) => handleSegmentTextChange(idx, e.target.value)}
                        placeholder="Koreksi teks di sini..."
                        style={{
                          flex: 1,
                          backgroundColor: 'transparent',
                          border: 'none',
                          color: '#f4f4f5',
                          fontSize: 12,
                          outline: 'none',
                          padding: '2px 4px',
                        }}
                      />

                      <button
                        type="button"
                        onClick={() => handleRemoveSegment(idx)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#52525b',
                          cursor: 'pointer',
                          padding: '2px 4px',
                        }}
                        title="Hapus baris ini"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Error Banner */}
            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 6,
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  fontSize: 12,
                }}
              >
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}

            {/* Real-time Render Progress Bar */}
            {isRendering && (
              <div
                style={{
                  padding: '12px',
                  backgroundColor: '#121214',
                  borderRadius: 6,
                  border: '1px solid #27272a',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#e4e4e7' }}>
                    <Loader2 size={13} className="spinner" />
                    {renderStage || 'Memproses rendering video...'}
                  </span>
                  <span style={{ fontWeight: 700, color: '#f4f4f5' }}>{renderProgress}%</span>
                </div>
                <div style={{ width: '100%', height: 6, backgroundColor: '#18181b', borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${renderProgress}%`,
                      backgroundColor: '#e4e4e7',
                      transition: 'width 0.25s ease',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Render Finished Notification & Download */}
            {isCompleted && !isRendering && (
              <div
                style={{
                  padding: '10px 12px',
                  backgroundColor: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.25)',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 size={16} color="#4ade80" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#4ade80' }}>
                    Video MP4 9:16 Berhasil Dirender!
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 11, padding: '4px 10px', height: 28 }}
                  onClick={handleDownload}
                  disabled={isDownloading}
                >
                  <Download size={12} />
                  {isDownloading ? 'Mengunduh...' : 'Unduh MP4'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Studio Footer Bar */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #27272a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#121214',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '6px 12px', color: '#a1a1aa' }}
              onClick={onClose}
            >
              Tutup
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '6px 14px', height: 34 }}
              onClick={handleSaveOnly}
              disabled={isSaving || isRendering}
            >
              {isSaving ? <Loader2 size={13} className="spinner" /> : null}
              {isSaving ? 'Menyimpan...' : 'Simpan Perubahan'}
            </button>

            <button
              id="btn-save-render-studio"
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '6px 16px', height: 34 }}
              onClick={handleSaveAndRender}
              disabled={isSaving || isRendering}
            >
              {isRendering ? <Loader2 size={14} className="spinner" /> : <Film size={14} />}
              {isRendering ? 'Sedang Merender...' : 'Simpan & Render MP4'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
