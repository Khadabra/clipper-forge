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
import { useState, useEffect, useRef, useMemo } from 'react';
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
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Gamepad2,
  XCircle,
  Smartphone,
  Square,
  RectangleVertical,
  Monitor,
  Grid3X3,
  Sliders,
  Volume2,
  Upload,
  Copy,
  Check,
  Share2,
  RefreshCw,
  Archive,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type {
  AspectRatio,
  AutoZoom,
  ClipCandidate,
  ClipSubtitleSegment,
  CropMode,
  SubtitleStyle,
  SEOCheckItem,
  TitleAnalysisResponse,
  TitleRecommendationItem,
  SocialCopyItem,
  SocialCopyPlatform,
  SoundboardCue,
  SoundboardSound,
} from '../../types/clip';
import {
  analyzeClipTitle,
  downloadExportKit,
  downloadRenderedClip,
  fetchClipTranscript,
  generateAndDownloadCover,
  generateClipSocialCopy,
  getClipSocialCopy,
  getRecommendedTitles,
  getRenderedClipStreamUrl,
  triggerRenderClip,
  updateClip,
  updateClipTranscript,
} from '../../services/clipsApi';
import { getMusicStreamUrl } from '../../services/musicApi';
import {
  fetchSoundboardSounds,
  getSoundStreamUrl as getSoundboardStreamUrl,
  uploadSound as uploadSoundboardSound,
} from '../../services/soundboardApi';
import { subscribeJobEvents } from '../../services/jobsApi';

interface Props {
  clip: ClipCandidate;
  isOpen: boolean;
  onClose: () => void;
  onClipUpdated?: (clip: ClipCandidate) => void;
  onClipRendered?: (clipId: string) => void;
  videoSourceUrl?: string;
  initialFocusSection?: 'general' | 'captions' | 'soundboard' | 'distribution';
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
    mode === 'streamer_split' ||
    mode === 'reframe' ||
    mode === 'single_speaker' ||
    mode === 'active_speaker' ||
    mode === 'split_screen' ||
    mode === 'manual_reframe'
  ) return mode;
  return 'blur_fill';
};

const normalizeAutoZoom = (zoom?: string): AutoZoom => {
  if (zoom === 'snap_hook' || zoom === 'none' || zoom === 'jump_cut') return zoom as AutoZoom;
  return 'snap_hook';
};

export const ClipEditorStudio: React.FC<Props> = ({
  clip,
  isOpen,
  onClose,
  onClipUpdated,
  onClipRendered,
  videoSourceUrl,
  initialFocusSection = 'general',
}) => {
  // Trim state
  const [trimStart, setTrimStart] = useState<number>(clip.start_time);
  const [trimEnd, setTrimEnd] = useState<number>(clip.end_time);

  // Title & SEO State
  const [clipTitle, setClipTitle] = useState<string>(clip.title || '');
  const [seoAnalysis, setSeoAnalysis] = useState<TitleAnalysisResponse | null>(null);
  const [isAnalyzingSeo, setIsAnalyzingSeo] = useState<boolean>(false);
  const [isChecklistExpanded, setIsChecklistExpanded] = useState<boolean>(false);
  const [recommendations, setRecommendations] = useState<TitleRecommendationItem[]>([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState<boolean>(false);
  const [showRecsDrawer, setShowRecsDrawer] = useState<boolean>(false);

  // Styling & Engine state
  const [autoZoom, setAutoZoom] = useState<AutoZoom>(normalizeAutoZoom(clip.auto_zoom));
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(clip.aspect_ratio || '9:16');
  const [cropXPct, setCropXPct] = useState<number>(clip.crop_x_pct ?? 0.50);
  const [removeSilence, setRemoveSilence] = useState<boolean>(clip.remove_silence ?? false);
  const [autoEmoji, setAutoEmoji] = useState<boolean>(clip.auto_emoji ?? true);
  const [showReframeGrid, setShowReframeGrid] = useState<boolean>(true);
  const [isDraggingCrop, setIsDraggingCrop] = useState<boolean>(false);
  const [cropMode, setCropMode] = useState<CropMode>(normalizeCropMode(clip.crop_mode));
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(normalizeSubtitleStyle(clip.subtitle_style));
  const [introHookBanner, setIntroHookBanner] = useState<boolean>(clip.intro_hook_banner !== false);
  const [isGeneratingCover, setIsGeneratingCover] = useState<boolean>(false);
  const [showSafeZone, setShowSafeZone] = useState<boolean>(false);
  const [framingOffsetX, setFramingOffsetX] = useState<number>(
    clip.framing_offset_pct ? Math.round(clip.framing_offset_pct * 100) : 0
  );
  const [enableSfx, setEnableSfx] = useState<boolean>(clip.enable_sfx !== false);

  // Background Music (BGM) playback state (legacy fallback)
  const [bgmTrackId, setBgmTrackId] = useState<string | null>(clip.bgm_track_id || null);
  const [bgmVolume, setBgmVolume] = useState<number>(
    clip.bgm_volume !== undefined ? Math.round(clip.bgm_volume * 100) : 18
  );
  const bgmPlayerRef = useRef<HTMLAudioElement>(null);

  // Meme Soundboard & Reaction SFX Engine state
  const [soundboardSounds, setSoundboardSounds] = useState<SoundboardSound[]>([]);
  const [soundboardCues, setSoundboardCues] = useState<SoundboardCue[]>([]);
  const [isLoadingSoundboard, setIsLoadingSoundboard] = useState<boolean>(false);
  const [isUploadingSound, setIsUploadingSound] = useState<boolean>(false);
  const [auditioningSoundId, setAuditioningSoundId] = useState<string | null>(null);
  const [openSfxDropdownIndex, setOpenSfxDropdownIndex] = useState<number | null>(null);
  const [autoDetectFeedback, setAutoDetectFeedback] = useState<string | null>(null);
  const soundFileInputRef = useRef<HTMLInputElement>(null);
  const auditionAudioRef = useRef<HTMLAudioElement>(null);
  const triggeredCuesRef = useRef<Set<string>>(new Set());

  // Milestone 7: AI Creator Publishing Suite & Social Media Copywriter state
  const [activeStudioTab, setActiveStudioTab] = useState<'editor' | 'distribution'>('editor');
  const [activeSocialPlatform, setActiveSocialPlatform] = useState<SocialCopyPlatform>('tiktok');
  const [socialCopies, setSocialCopies] = useState<Record<string, SocialCopyItem> | null>(null);
  const [isLoadingSocialCopy, setIsLoadingSocialCopy] = useState(false);
  const [isGeneratingSocialCopy, setIsGeneratingSocialCopy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [customSocialTopic, setCustomSocialTopic] = useState('');
  const [isDownloadingKit, setIsDownloadingKit] = useState(false);
  const [socialError, setSocialError] = useState<string | null>(null);

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
  const facecamVideoRef = useRef<HTMLVideoElement>(null);
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
      setClipTitle(clip.title || '');
      setShowRecsDrawer(false);
      setRecommendations([]);
      setAutoZoom(normalizeAutoZoom(clip.auto_zoom));
      setAspectRatio(clip.aspect_ratio || '9:16');
      setCropXPct(clip.crop_x_pct ?? 0.50);
      setRemoveSilence(clip.remove_silence ?? false);
      setAutoEmoji(clip.auto_emoji ?? true);
      setCropMode(normalizeCropMode(clip.crop_mode));
      setSubtitleStyle(normalizeSubtitleStyle(clip.subtitle_style));
      setIntroHookBanner(clip.intro_hook_banner !== false);
      setFramingOffsetX(clip.framing_offset_pct ? Math.round(clip.framing_offset_pct * 100) : 0);
      setEnableSfx(clip.enable_sfx !== false);
      setBgmTrackId(clip.bgm_track_id || null);
      setBgmVolume(clip.bgm_volume !== undefined ? Math.round(clip.bgm_volume * 100) : 18);
      if (bgmPlayerRef.current) bgmPlayerRef.current.pause();

      // Initialize social copy state & focus tab
      if (initialFocusSection === 'distribution') {
        setActiveStudioTab('distribution');
      } else {
        setActiveStudioTab('editor');
        if (initialFocusSection === 'captions') {
          setTimeout(() => {
            const el = document.getElementById('subtitle-editor-panel');
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 200);
        } else if (initialFocusSection === 'soundboard') {
          setTimeout(() => {
            const el = document.getElementById('soundboard-sfx-panel');
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 200);
        }
      }
      setCopiedKey(null);
      setCustomSocialTopic('');
      setSocialError(null);
      if (clip.social_copy_json) {
        try {
          const parsed = JSON.parse(clip.social_copy_json);
          setSocialCopies(parsed);
        } catch {
          setSocialCopies(null);
        }
      } else {
        setSocialCopies(null);
      }

      // Initialize Meme Soundboard SFX cues
      try {
        if (clip.soundboard_cues_json) {
          const parsed = JSON.parse(clip.soundboard_cues_json);
          setSoundboardCues(Array.isArray(parsed) ? parsed : []);
        } else {
          setSoundboardCues([]);
        }
      } catch {
        setSoundboardCues([]);
      }
      setAuditioningSoundId(null);
      if (auditionAudioRef.current) auditionAudioRef.current.pause();
      triggeredCuesRef.current.clear();

      // Load Meme Soundboard library
      setIsLoadingSoundboard(true);
      fetchSoundboardSounds()
        .then((sounds) => setSoundboardSounds(sounds))
        .catch((err) => console.error('Gagal memuat pustaka Meme Soundboard:', err))
        .finally(() => setIsLoadingSoundboard(false));


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
          // Default ke speaker_track jika klip terdeteksi memiliki 2 pembicara
          const distinctSpeakers = new Set(
            data.map((s, idx) => s.speaker_label || (idx % 2 === 1 ? 'Speaker B' : 'Speaker A'))
          );
          if (distinctSpeakers.size >= 2 && (!clip.crop_mode || clip.crop_mode === 'blur_fill')) {
            setCropMode('speaker_track');
          }
        })
        .catch((err) => {
          setTranscriptError(err.message || 'Gagal memuat teks transkrip.');
          setIsLoadingTranscript(false);
        });
    }
  }, [isOpen, clip]);

  // Load or auto-generate social media copies
  const loadSocialCopies = async (forceRegenerate = false, platform = 'all') => {
    setSocialError(null);
    if (forceRegenerate) {
      setIsGeneratingSocialCopy(true);
    } else {
      setIsLoadingSocialCopy(true);
    }

    try {
      if (forceRegenerate) {
        const res = await generateClipSocialCopy(clip.id, platform, customSocialTopic || undefined);
        setSocialCopies((prev) => ({ ...(prev || {}), ...(res.copies || {}) }));
      } else {
        const res = await getClipSocialCopy(clip.id);
        setSocialCopies(res.copies || {});
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat copy media sosial.';
      setSocialError(msg);
    } finally {
      setIsLoadingSocialCopy(false);
      setIsGeneratingSocialCopy(false);
    }
  };

  // Copy text to clipboard with animated feedback & floating toast
  const handleCopyToClipboard = (text: string, keyName: string, label: string = 'Teks berhasil disalin ke clipboard!') => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setToastMessage(label);
    setTimeout(() => {
      setCopiedKey(null);
    }, 2500);
    setTimeout(() => {
      setToastMessage(null);
    }, 2000);
  };

  // 1-Click Publishing Kit (.zip) download handler
  const handleDownloadPublishingKit = async () => {
    setIsDownloadingKit(true);
    setSocialError(null);
    try {
      await downloadExportKit(clip.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengunduh paket publishing kit.';
      setSocialError(msg);
    } finally {
      setIsDownloadingKit(false);
    }
  };

  // Real-time debounced SEO title analyzer
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      setIsAnalyzingSeo(true);
      analyzeClipTitle(clip.id, clipTitle)
        .then((data) => {
          setSeoAnalysis(data);
          setIsAnalyzingSeo(false);
        })
        .catch(() => {
          setIsAnalyzingSeo(false);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [clipTitle, clip.id, isOpen]);

  const handleFetchRecommendations = async () => {
    setIsLoadingRecommendations(true);
    setShowRecsDrawer(true);
    try {
      const data = await getRecommendedTitles(clip.id);
      setRecommendations(data.recommendations || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingRecommendations(false);
    }
  };

  const handleApplyRecommendedTitle = (newTitle: string) => {
    setClipTitle(newTitle);
    setShowRecsDrawer(false);
  };

  // 2. Enforce bounded loop preview in the player
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const cur = videoRef.current.currentTime;
      setCurrentPlayTime(cur);

      if (bgVideoRef.current && Math.abs(bgVideoRef.current.currentTime - cur) > 0.3) {
        bgVideoRef.current.currentTime = cur;
      }
      if (facecamVideoRef.current && Math.abs(facecamVideoRef.current.currentTime - cur) > 0.3) {
        facecamVideoRef.current.currentTime = cur;
      }

      // Live Preview: Trigger meme soundboard SFX when video playback reaches cue timestamp
      if (soundboardCues.length > 0) {
        soundboardCues.forEach((cue) => {
          const cueKey = `${cue.sound_id}_${cue.timestamp.toFixed(2)}`;
          if (Math.abs(cur - cue.timestamp) < 0.20) {
            if (!triggeredCuesRef.current.has(cueKey)) {
              triggeredCuesRef.current.add(cueKey);
              const audio = new Audio(getSoundboardStreamUrl(cue.sound_id));
              audio.volume = cue.volume !== undefined ? Math.max(0, Math.min(1, cue.volume)) : 0.9;
              audio.play().catch(() => {});
            }
          }
        });
      }

      if (cur >= trimEnd) {
        triggeredCuesRef.current.clear();
        videoRef.current.currentTime = trimStart;
        if (bgVideoRef.current) bgVideoRef.current.currentTime = trimStart;
        if (facecamVideoRef.current) facecamVideoRef.current.currentTime = trimStart;
        if (bgmPlayerRef.current) bgmPlayerRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {});
        if (bgVideoRef.current) bgVideoRef.current.play().catch(() => {});
        if (facecamVideoRef.current) facecamVideoRef.current.play().catch(() => {});
        if (bgmPlayerRef.current && bgmTrackId) bgmPlayerRef.current.play().catch(() => {});
      } else if (cur < trimStart - 0.5) {
        triggeredCuesRef.current.clear();
        videoRef.current.currentTime = trimStart;
        if (bgVideoRef.current) bgVideoRef.current.currentTime = trimStart;
        if (facecamVideoRef.current) facecamVideoRef.current.currentTime = trimStart;
        if (bgmPlayerRef.current) bgmPlayerRef.current.currentTime = 0;
      }
    }
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      if (bgVideoRef.current) bgVideoRef.current.pause();
      if (facecamVideoRef.current) facecamVideoRef.current.pause();
      if (bgmPlayerRef.current) bgmPlayerRef.current.pause();
      setIsPlaying(false);
    } else {
      triggeredCuesRef.current.clear();
      if (videoRef.current.currentTime < trimStart || videoRef.current.currentTime >= trimEnd) {
        videoRef.current.currentTime = trimStart;
        if (bgVideoRef.current) bgVideoRef.current.currentTime = trimStart;
        if (facecamVideoRef.current) facecamVideoRef.current.currentTime = trimStart;
        if (bgmPlayerRef.current) bgmPlayerRef.current.currentTime = 0;
      }
      if (bgmTrackId && bgmPlayerRef.current) {
        bgmPlayerRef.current.src = getMusicStreamUrl(bgmTrackId);
        bgmPlayerRef.current.volume = bgmVolume / 100;
        bgmPlayerRef.current.play().catch(() => {});
      }
      videoRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
          if (bgVideoRef.current) bgVideoRef.current.play().catch(() => {});
          if (facecamVideoRef.current) facecamVideoRef.current.play().catch(() => {});
        })
        .catch(() => {});
    }
  };

  // ── Meme Soundboard & Reaction SFX Engine Handlers ─────────────────────────

  const toggleAuditionSound = (soundId: string) => {
    if (auditioningSoundId === soundId) {
      if (auditionAudioRef.current) auditionAudioRef.current.pause();
      setAuditioningSoundId(null);
    } else {
      if (auditionAudioRef.current) {
        auditionAudioRef.current.src = getSoundboardStreamUrl(soundId);
        auditionAudioRef.current.volume = 0.9;
        auditionAudioRef.current.currentTime = 0;
        auditionAudioRef.current.play().catch(() => {});
      }
      setAuditioningSoundId(soundId);
    }
  };

  const handleAddCueAtCurrentTime = (soundId: string) => {
    const ts = Number(currentPlayTime.toFixed(2));
    const newCue: SoundboardCue = {
      id: `cue_${Date.now()}`,
      sound_id: soundId,
      timestamp: ts,
      volume: 0.9,
    };
    const updated = [...soundboardCues, newCue].sort((a, b) => a.timestamp - b.timestamp);
    setSoundboardCues(updated);

    // Play quick audio feedback
    const audio = new Audio(getSoundboardStreamUrl(soundId));
    audio.volume = 0.9;
    audio.play().catch(() => {});
  };

  const handleAddCueAtSegment = (segIdx: number, soundId: string) => {
    const seg = segments[segIdx];
    if (!seg) return;
    const segId = seg.id || `seg_${segIdx}`;
    const filtered = soundboardCues.filter(
      (c) => !(c.segment_id === segId || Math.abs(c.timestamp - seg.start_time) < 0.35)
    );
    filtered.push({
      id: `cue_seg_${segIdx}_${Date.now()}`,
      sound_id: soundId,
      timestamp: Number(seg.start_time.toFixed(2)),
      volume: 0.9,
      segment_id: segId,
    });
    filtered.sort((a, b) => a.timestamp - b.timestamp);
    setSoundboardCues(filtered);

    // Play quick feedback
    const audio = new Audio(getSoundboardStreamUrl(soundId));
    audio.volume = 0.9;
    audio.play().catch(() => {});
  };

  const handleRemoveCue = (cueToRemove: SoundboardCue) => {
    setSoundboardCues((prev) =>
      prev.filter(
        (c) =>
          !(
            (c.id && cueToRemove.id && c.id === cueToRemove.id) ||
            (c.sound_id === cueToRemove.sound_id && Math.abs(c.timestamp - cueToRemove.timestamp) < 0.05)
          )
      )
    );
  };

  const handleCueVolumeChange = (cIdx: number, vol: number) => {
    setSoundboardCues((prev) =>
      prev.map((c, i) => (i === cIdx ? { ...c, volume: vol } : c))
    );
  };

  const handleAutoDetectCues = () => {
    if (!segments || segments.length === 0) {
      setAutoDetectFeedback('Transkrip subtitle belum tersedia untuk auto-detect.');
      setTimeout(() => setAutoDetectFeedback(null), 3000);
      return;
    }

    const newCues: SoundboardCue[] = [...soundboardCues];
    let detectedCount = 0;

    const shockKeywords = [
      '?', '!', 'apa', 'kenapa', 'bagaimana', 'gila', 'astaga', 'wow',
      'what', 'omg', 'shock', 'serius', 'bohong', 'anjir', 'waduh', 'anj',
      'buset', 'anjay', 'parah', 'kaget', 'lah', 'loh', 'beneran', 'kok bisa'
    ];

    segments.forEach((seg, idx) => {
      const textLower = seg.text.toLowerCase().trim();
      const isQuestionOrShock =
        textLower.includes('?') ||
        textLower.includes('!') ||
        shockKeywords.some((kw) => textLower.includes(kw));

      if (isQuestionOrShock) {
        const exists = newCues.some(
          (c) => Math.abs(c.timestamp - seg.start_time) < 0.75
        );
        if (!exists) {
          newCues.push({
            id: `auto_vb_${idx}_${Date.now()}`,
            sound_id: 'vine_boom',
            timestamp: Number(seg.start_time.toFixed(2)),
            volume: 0.90,
            segment_id: seg.id || `seg_${idx}`,
          });
          detectedCount++;
        }
      }

      // Silent pause / dead air detection between consecutive segments
      if (idx < segments.length - 1) {
        const nextSeg = segments[idx + 1];
        const gap = nextSeg.start_time - seg.end_time;
        if (gap >= 1.2) {
          const pauseTime = Number((seg.end_time + 0.20).toFixed(2));
          const exists = newCues.some(
            (c) => Math.abs(c.timestamp - pauseTime) < 0.75
          );
          if (!exists) {
            newCues.push({
              id: `auto_cr_${idx}_${Date.now()}`,
              sound_id: 'crickets_silence',
              timestamp: pauseTime,
              volume: 0.85,
            });
            detectedCount++;
          }
        }
      }
    });

    newCues.sort((a, b) => a.timestamp - b.timestamp);
    setSoundboardCues(newCues);
    setAutoDetectFeedback(
      detectedCount > 0
        ? `⚡ Berhasil memasang ${detectedCount} SFX momen otomatis!`
        : `Momen tanda tanya dan jeda hening sudah memiliki cue SFX.`
    );
    setTimeout(() => setAutoDetectFeedback(null), 3500);
  };

  const handleUploadSoundFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingSound(true);
    setError(null);
    try {
      const newSound = await uploadSoundboardSound(file);
      setSoundboardSounds((prev) => [...prev, newSound]);
      handleAddCueAtCurrentTime(newSound.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengunggah file SFX soundboard.';
      setError(msg);
    } finally {
      setIsUploadingSound(false);
      if (soundFileInputRef.current) soundFileInputRef.current.value = '';
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

  // Precompute de-jittered speaker schedule for smooth live preview switching (Multicam, no center rack cut)
  const speakerSchedule = useMemo(() => {
    if (!segments || segments.length === 0) return [];

    const valid = segments
      .filter((s) => s.end_time > s.start_time)
      .map((s, i) => {
        let spk: 'Speaker A' | 'Speaker B' = 'Speaker A';
        if (s.speaker_label) {
          const l = s.speaker_label.toLowerCase();
          if (l.includes('b') || l.includes('2') || l.includes('kanan') || l.includes('right') || l.includes('guest')) {
            spk = 'Speaker B';
          }
        } else {
          spk = i % 2 === 1 ? 'Speaker B' : 'Speaker A';
        }
        return { start: s.start_time, end: s.end_time, speaker: spk, text: s.text.toLowerCase() };
      })
      .sort((a, b) => a.start - b.start);

    if (valid.length === 0) return [];

    // Step 1: Overlap resolution — Hold on active speaker during laughs/overlaps, no center rack cut
    const cleaned: Array<{ start: number; end: number; speaker: 'Speaker A' | 'Speaker B' }> = [];
    for (const cur of valid) {
      if (cleaned.length === 0) {
        cleaned.push({ start: cur.start, end: cur.end, speaker: cur.speaker });
        continue;
      }
      const prev = cleaned[cleaned.length - 1];
      if (cur.start < prev.end) {
        if (cur.speaker === prev.speaker) {
          prev.end = Math.max(prev.end, cur.end);
        } else {
          // Camera lock: hold on current speaker; switch only if new speaker has substantial remaining turn
          if (cur.end > prev.end) {
            const remStart = prev.end;
            if (cur.end - remStart >= 0.6) {
              cleaned.push({ start: remStart, end: cur.end, speaker: cur.speaker });
            }
          }
        }
      } else {
        cleaned.push({ start: cur.start, end: cur.end, speaker: cur.speaker });
      }
    }

    // Step 2: Merge consecutive segments for same speaker with small pauses (<= 1.0s)
    const merged: Array<{ start: number; end: number; speaker: 'Speaker A' | 'Speaker B' }> = [];
    for (const seg of cleaned) {
      if (merged.length === 0) {
        merged.push({ ...seg });
      } else {
        const last = merged[merged.length - 1];
        if (last.speaker === seg.speaker && seg.start - last.end <= 1.0) {
          last.end = Math.max(last.end, seg.end);
        } else {
          merged.push({ ...seg });
        }
      }
    }

    // Step 3: Enforce Minimum Hold Duration (2.8s)
    const minHold = 2.8;
    const stable: Array<{ start: number; end: number; speaker: 'Speaker A' | 'Speaker B' }> = [];
    for (const turn of merged) {
      if (stable.length === 0) {
        stable.push({ ...turn });
        continue;
      }
      const currShot = stable[stable.length - 1];
      const turnDur = turn.end - turn.start;
      if (turn.speaker === currShot.speaker) {
        currShot.end = Math.max(currShot.end, turn.end);
        continue;
      }

      const held = turn.start - currShot.start;
      if (turnDur < minHold) {
        currShot.end = Math.max(currShot.end, turn.end);
      } else if (held < minHold) {
        const delayed = currShot.start + minHold;
        if (delayed < turn.end) {
          currShot.end = Math.min(currShot.end, delayed);
          stable.push({ start: delayed, end: turn.end, speaker: turn.speaker });
        } else {
          currShot.end = Math.max(currShot.end, turn.end);
        }
      } else {
        currShot.end = Math.min(currShot.end, turn.start);
        stable.push({ ...turn });
      }
    }

    // Step 4: Silence Fallback: Hold on last active speaker (no center rack pan)
    const fullSchedule: Array<{ start: number; end: number; speaker: 'Speaker A' | 'Speaker B' }> = [];
    for (const shot of stable) {
      if (fullSchedule.length > 0) {
        const prev = fullSchedule[fullSchedule.length - 1];
        if (shot.start > prev.end) {
          fullSchedule.push({ start: prev.end, end: shot.start, speaker: prev.speaker });
        }
      }
      fullSchedule.push({ ...shot });
    }

    return fullSchedule;
  }, [segments]);

  // Determine active speaker for live preview in Speaker Track mode from de-jittered schedule
  const getActiveSpeakerForTime = (time: number): 'Speaker A' | 'Speaker B' => {
    if (speakerSchedule.length === 0) return 'Speaker A';
    const match = speakerSchedule.find((shot) => time >= shot.start && time < shot.end);
    if (match) return match.speaker;
    const prev = [...speakerSchedule].reverse().find((shot) => time >= shot.end);
    if (prev) return prev.speaker;
    return speakerSchedule[0].speaker;
  };

  const activeSpeakerFocus = getActiveSpeakerForTime(currentPlayTime);
  const elapsedInClip = Math.max(0, currentPlayTime - trimStart);
  const isJumpCutMoment =
    (autoZoom === 'jump_cut' || autoZoom === 'snap_hook') && (elapsedInClip % 5.0 < 2.0);

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
        title: clipTitle.trim() || clip.title,
        start_time: Number(trimStart.toFixed(2)),
        end_time: Number(trimEnd.toFixed(2)),
        aspect_ratio: aspectRatio,
        crop_x_pct: Number(cropXPct.toFixed(3)),
        remove_silence: removeSilence,
        auto_emoji: autoEmoji,
        crop_mode: cropMode,
        subtitle_style: subtitleStyle,
        auto_zoom: autoZoom,
        intro_hook_banner: introHookBanner,
        show_hook_banner: introHookBanner,
        framing_offset_pct: Number((framingOffsetX / 100).toFixed(3)),
        enable_sfx: enableSfx,
        bgm_track_id: bgmTrackId,
        bgm_volume: Number((bgmVolume / 100).toFixed(2)),
        soundboard_cues_json: JSON.stringify(soundboardCues),
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
        crop_x_pct: Number(cropXPct.toFixed(3)),
        remove_silence: removeSilence,
        auto_emoji: autoEmoji,
        crop_mode: cropMode,
        subtitle_style: subtitleStyle,
        auto_zoom: autoZoom,
        intro_hook_banner: introHookBanner,
        show_hook_banner: introHookBanner,
        enable_sfx: enableSfx,
        framing_offset_pct: Number((framingOffsetX / 100).toFixed(3)),
        bgm_track_id: bgmTrackId,
        bgm_volume: Number((bgmVolume / 100).toFixed(2)),
        soundboard_cues: soundboardCues,
        soundboard_cues_json: JSON.stringify(soundboardCues),
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

  const handleDownloadCover = async () => {
    setIsGeneratingCover(true);
    setError(null);
    try {
      await generateAndDownloadCover(
        clip.id,
        `cover_${clip.id.slice(0, 8)}_1080x1920.jpg`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat cover JPG.';
      setError(msg);
    } finally {
      setIsGeneratingCover(false);
    }
  };

  // Live Real-Time Subtitle Overlay Renderer
  const renderLiveSubtitleOverlay = () => {
    const active =
      segments.find((s) => currentPlayTime >= s.start_time && currentPlayTime <= s.end_time) ||
      segments[0];

    if (!active || !active.text.trim()) return null;

    const injectEmoji = (txt: string) => {
      if (!autoEmoji) return txt;
      const emojiMap: Record<string, string> = {
        uang: '💸', duit: '💸', kaya: '💸', bisnis: '💸', cuan: '💸', money: '💸',
        kaget: '😱', syok: '😱', shock: '😱', gila: '😱', mati: '😱', ngeri: '😱',
        viral: '🔥', api: '🔥', heboh: '🔥', trending: '🔥', mantap: '🔥', keren: '🔥',
        lucu: '😂', ketawa: '😂', ngakak: '😂', wkwk: '😂', haha: '😂', lol: '😂',
        ide: '💡', solusi: '💡', trik: '💡', cara: '💡', tips: '💡', rahasia: '💡',
      };
      return txt
        .split(/\s+/)
        .map((w) => {
          const clean = w.toLowerCase().replace(/[^a-z0-9]/g, '');
          const em = emojiMap[clean];
          return em ? `${w} ${em}` : w;
        })
        .join(' ');
    };

    const displayText = injectEmoji(active.text);

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
          {displayText}
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
          {displayText}
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
          {displayText}
        </span>
      );
    }

    if (subtitleStyle === 'cyber_neon') {
      const words = active.text.trim().split(/\s+/);
      return (
        <span
          style={{
            fontFamily: "'Arial Black', 'Impact', sans-serif",
            fontWeight: 900,
            fontSize: 17,
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            color: '#FFFFFF',
            textShadow:
              '3.5px 3.5px 0 #000000, -3.5px -3.5px 0 #000000, 3.5px -3.5px 0 #000000, -3.5px 3.5px 0 #000000, 0 0 12px rgba(204, 255, 0, 0.65)',
            lineHeight: 1.25,
            display: 'inline-flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          {words.map((w, i) => {
            const isHook = i === 0 || i === words.length - 1 || w.length > 5;
            return (
              <span
                key={`${active.start_time}-${w}-${i}`}
                style={{
                  color: isHook ? '#CCFF00' : '#FFFFFF',
                  textShadow: isHook
                    ? '3.5px 3.5px 0 #000000, -3.5px -3.5px 0 #000000, 3.5px -3.5px 0 #000000, -3.5px 3.5px 0 #000000, 0 0 16px #CCFF00'
                    : '3.5px 3.5px 0 #000000, -3.5px -3.5px 0 #000000, 3.5px -3.5px 0 #000000, -3.5px 3.5px 0 #000000',
                  display: 'inline-block',
                }}
              >
                {w}
              </span>
            );
          })}
        </span>
      );
    }

    if (subtitleStyle === 'word_highlight') {
      const tokens = active.text.trim().split(/\s+/);
      if (tokens.length === 0) return null;

      // Micro-Chunking: strictly 2 to 3 words max simultaneously
      const chunks: string[][] = [];
      let i = 0;
      while (i < tokens.length) {
        const rem = tokens.length - i;
        const take = (rem === 2 || rem === 4) ? 2 : Math.min(3, rem);
        chunks.push(tokens.slice(i, i + take));
        i += take;
      }

      const segDur = Math.max(0.1, active.end_time - active.start_time);
      const elapsed = Math.max(0, currentPlayTime - active.start_time);
      const progress = Math.min(0.999, elapsed / segDur);

      const totalWords = tokens.length;
      const globalActiveWordIdx = Math.min(totalWords - 1, Math.floor(progress * totalWords));

      let wordCounter = 0;
      let activeChunkIdx = 0;
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunkLen = chunks[ci].length;
        if (globalActiveWordIdx >= wordCounter && globalActiveWordIdx < wordCounter + chunkLen) {
          activeChunkIdx = ci;
          break;
        }
        wordCounter += chunkLen;
      }

      let activeChunkStartWord = 0;
      for (let ci = 0; ci < activeChunkIdx; ci++) {
        activeChunkStartWord += chunks[ci].length;
      }
      const localActiveWordIdx = globalActiveWordIdx - activeChunkStartWord;
      const currentChunkWords = chunks[activeChunkIdx] || chunks[0];

      return (
        <span
          style={{
            fontFamily: "'Impact', 'Arial Black', sans-serif",
            fontWeight: 900,
            fontSize: 20,
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            lineHeight: 1.25,
            display: 'inline-flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '10px',
          }}
        >
          {currentChunkWords.map((token, idx) => {
            const isWordActive = idx === localActiveWordIdx;
            const clean = token.toLowerCase().replace(/[^a-z0-9]/g, '');
            const emojiMap: Record<string, string> = {
              uang: '💸', duit: '💸', kaya: '💸', bisnis: '💸', cuan: '💸', money: '💸',
              kaget: '😱', syok: '😱', shock: '😱', gila: '😱', mati: '😱', ngeri: '😱',
              viral: '🔥', api: '🔥', heboh: '🔥', trending: '🔥', mantap: '🔥', keren: '🔥',
              lucu: '😂', ketawa: '😂', ngakak: '😂', wkwk: '😂', haha: '😂', lol: '😂',
              ide: '💡', solusi: '💡', trik: '💡', cara: '💡', tips: '💡', rahasia: '💡',
            };
            const em = autoEmoji && isWordActive ? emojiMap[clean] : null;
            const displayToken = em ? `${token} ${em}` : token;
            return (
              <span
                key={`${active.start_time}-${activeChunkIdx}-${token}-${idx}`}
                style={{
                  color: isWordActive ? '#FFE500' : '#FFFFFF',
                  transform: isWordActive ? 'scale(1.18)' : 'scale(1)',
                  textShadow: isWordActive
                    ? '4.5px 4.5px 0 #000, -4.5px -4.5px 0 #000, 4.5px -4.5px 0 #000, -4.5px 4.5px 0 #000, 0 0 18px rgba(255, 229, 0, 0.95)'
                    : '4.5px 4.5px 0 #000, -4.5px -4.5px 0 #000, 4.5px -4.5px 0 #000, -4.5px 4.5px 0 #000, 0 4px 10px rgba(0,0,0,0.95)',
                  transition: 'transform 0.08s ease, color 0.08s ease',
                  display: 'inline-block',
                }}
              >
                {displayToken}
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
                {clipTitle || clip.title} • Durasi: {duration.toFixed(1)}s
              </p>
            </div>
          </div>

          {/* Center: Mode Tabs */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              backgroundColor: '#18181b',
              padding: '3px',
              borderRadius: 6,
              border: '1px solid #27272a',
            }}
          >
            <button
              type="button"
              id="tab-mode-editor"
              onClick={() => setActiveStudioTab('editor')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                borderRadius: 4,
                border: 'none',
                backgroundColor: activeStudioTab === 'editor' ? '#27272a' : 'transparent',
                color: activeStudioTab === 'editor' ? '#f4f4f5' : '#71717a',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <Sliders size={13} />
              Editor Visual & Audio
            </button>

            <button
              type="button"
              id="tab-mode-distribution"
              onClick={() => {
                setActiveStudioTab('distribution');
                if (!socialCopies) {
                  loadSocialCopies();
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                borderRadius: 4,
                border: 'none',
                backgroundColor: activeStudioTab === 'distribution' ? '#27272a' : 'transparent',
                color: activeStudioTab === 'distribution' ? '#38bdf8' : '#71717a',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <Share2 size={13} color={activeStudioTab === 'distribution' ? '#38bdf8' : 'currentColor'} />
              Distribusi & AI Copywriter
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  padding: '1px 5px',
                  borderRadius: 3,
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                }}
              >
                AI
              </span>
            </button>
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
            {/* Preview Mode Tab Switcher & Safe-Zone Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
              }}
            >
              <div
                style={{
                  flex: 1,
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

              {previewTab === 'edit' && (
                <button
                  type="button"
                  id="btn-toggle-safe-zone"
                  onClick={() => setShowSafeZone((prev) => !prev)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: showSafeZone ? '1px solid #10b981' : '1px solid #27272a',
                    backgroundColor: showSafeZone ? 'rgba(16, 185, 129, 0.15)' : '#121214',
                    color: showSafeZone ? '#34d399' : '#a1a1aa',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                  }}
                  title="Tampilkan Safe-Zone Grid HP (area tombol Like/Komen sisi kanan & teks caption bawah TikTok/Shorts)"
                >
                  <Smartphone size={12} color={showSafeZone ? '#34d399' : '#a1a1aa'} />
                  <span>Safe-Zone Grid HP</span>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: showSafeZone ? '#10b981' : '#52525b',
                      display: 'inline-block',
                    }}
                  />
                </button>
              )}
            </div>

            {/* Aspect Ratio Toolbar (9:16, 1:1, 4:5, 16:9) - Modern Segmented Pill Control */}
            <div
              id="aspect-ratio-toolbar"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 4,
                padding: '4px',
                backgroundColor: '#121214',
                borderRadius: 10,
                border: '1px solid #27272a',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
                position: 'relative',
              }}
            >
              {[
                { id: '9:16', label: '9:16 Vertikal', sub: 'TikTok/Shorts', icon: <Smartphone size={13} /> },
                { id: '1:1', label: '1:1 Persegi', sub: 'Feed Square', icon: <Square size={13} /> },
                { id: '4:5', label: '4:5 Portrait', sub: 'Instagram', icon: <RectangleVertical size={13} /> },
                { id: '16:9', label: '16:9 Lanskap', sub: 'Horizontal', icon: <Monitor size={13} /> },
              ].map((item) => {
                const isActive = aspectRatio === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    id={`btn-aspect-ratio-${item.id.replace(':', '-')}`}
                    onClick={() => setAspectRatio(item.id as AspectRatio)}
                    style={{
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 2,
                      padding: '7px 4px',
                      borderRadius: 7,
                      border: '1px solid transparent',
                      backgroundColor: 'transparent',
                      color: isActive ? '#f4f4f5' : '#71717a',
                      cursor: 'pointer',
                      zIndex: 1,
                      transition: 'color 0.15s ease',
                      outline: 'none',
                    }}
                    title={`Rasio Aspek ${item.label} (${item.sub})`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="aspectRatioPillIndicator"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          backgroundColor: 'rgba(39, 39, 42, 0.85)',
                          borderRadius: 7,
                          border: '1px solid #3f3f46',
                          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
                          zIndex: -1,
                        }}
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ color: isActive ? '#10b981' : 'currentColor', display: 'flex', alignItems: 'center' }}>
                        {item.icon}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: isActive ? 700 : 500, color: isActive ? '#f4f4f5' : '#a1a1aa' }}>
                        {item.id}
                      </span>
                    </div>
                    <span style={{ fontSize: 8.5, color: isActive ? '#a1a1aa' : '#52525b', whiteSpace: 'nowrap' }}>
                      {item.sub}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Reframe Quick Position Bar & 3x3 Grid Toggle */}
            {aspectRatio !== '16:9' && (
              <div
                id="reframe-quick-bar"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 12px',
                  backgroundColor: '#121214',
                  borderRadius: 8,
                  border: '1px solid #27272a',
                  fontSize: 11,
                  boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      backgroundColor: 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Grid3X3 size={11} color="#10b981" />
                  </div>
                  <span style={{ color: '#f4f4f5', fontWeight: 600 }}>
                    Reframe: {Math.round(cropXPct * 100)}%
                  </span>
                  <span style={{ color: '#71717a', fontSize: 10 }}>
                    ({cropXPct <= 0.35 ? 'Kiri' : cropXPct >= 0.65 ? 'Kanan' : 'Tengah'})
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <button
                    type="button"
                    id="btn-crop-pos-left"
                    onClick={() => setCropXPct(0.20)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 5,
                      border: Math.abs(cropXPct - 0.20) < 0.05 ? '1px solid #10b981' : '1px solid #27272a',
                      backgroundColor: Math.abs(cropXPct - 0.20) < 0.05 ? 'rgba(16, 185, 129, 0.15)' : '#18181b',
                      color: Math.abs(cropXPct - 0.20) < 0.05 ? '#34d399' : '#a1a1aa',
                      fontSize: 10.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    title="Posisikan fokus frame di 20% sisi kiri"
                  >
                    Kiri 20%
                  </button>
                  <button
                    type="button"
                    id="btn-crop-pos-center"
                    onClick={() => setCropXPct(0.50)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 5,
                      border: Math.abs(cropXPct - 0.50) < 0.05 ? '1px solid #10b981' : '1px solid #27272a',
                      backgroundColor: Math.abs(cropXPct - 0.50) < 0.05 ? 'rgba(16, 185, 129, 0.15)' : '#18181b',
                      color: Math.abs(cropXPct - 0.50) < 0.05 ? '#34d399' : '#a1a1aa',
                      fontSize: 10.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    title="Posisikan fokus frame di tengah 50%"
                  >
                    Tengah 50%
                  </button>
                  <button
                    type="button"
                    id="btn-crop-pos-right"
                    onClick={() => setCropXPct(0.80)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 5,
                      border: Math.abs(cropXPct - 0.80) < 0.05 ? '1px solid #10b981' : '1px solid #27272a',
                      backgroundColor: Math.abs(cropXPct - 0.80) < 0.05 ? 'rgba(16, 185, 129, 0.15)' : '#18181b',
                      color: Math.abs(cropXPct - 0.80) < 0.05 ? '#34d399' : '#a1a1aa',
                      fontSize: 10.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    title="Posisikan fokus frame di 80% sisi kanan"
                  >
                    Kanan 80%
                  </button>
                  <button
                    type="button"
                    id="btn-toggle-reframe-grid"
                    onClick={() => setShowReframeGrid((prev) => !prev)}
                    style={{
                      padding: '3px 9px',
                      borderRadius: 5,
                      border: showReframeGrid ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid #27272a',
                      backgroundColor: showReframeGrid ? 'rgba(16, 185, 129, 0.15)' : '#18181b',
                      color: showReframeGrid ? '#34d399' : '#71717a',
                      fontSize: 10.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      transition: 'all 0.15s ease',
                    }}
                    title="Tampilkan / Sembunyikan garis Rule of Thirds 3x3"
                  >
                    <Grid3X3 size={11} />
                    <span>3x3</span>
                  </button>
                </div>
              </div>
            )}

            {/* Live Interactive WYSIWYG Player Box */}
            {previewTab === 'edit' ? (
              <div
                style={{
                  position: 'relative',
                  borderRadius: 8,
                  overflow: 'hidden',
                  backgroundColor: '#000000',
                  border: '1px solid #27272a',
                  aspectRatio:
                    aspectRatio === '9:16'
                      ? '9/16'
                      : aspectRatio === '1:1'
                      ? '1/1'
                      : aspectRatio === '4:5'
                      ? '4/5'
                      : '16/9',
                  maxHeight:
                    aspectRatio === '9:16'
                      ? '380px'
                      : aspectRatio === '4:5'
                      ? '340px'
                      : aspectRatio === '1:1'
                      ? '300px'
                      : '220px',
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
                {cropMode === 'streamer_split' ? (
                  <div
                    style={{
                      position: 'relative',
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                      backgroundColor: '#000000',
                    }}
                  >
                    {/* Top Half: Facecam Streamer */}
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        height: '50%',
                        overflow: 'hidden',
                        borderBottom: '2px solid #27272a',
                        backgroundColor: '#09090b',
                      }}
                    >
                      <video
                        ref={facecamVideoRef}
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
                          objectPosition: '85% 75%',
                          transform: isJumpCutMoment ? 'scale(1.18)' : 'scale(1.0)',
                          transition: 'none',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          top: 8,
                          left: 8,
                          zIndex: 5,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          backgroundColor: 'rgba(9, 9, 11, 0.85)',
                          border: '1px solid rgba(139, 92, 246, 0.4)',
                          borderRadius: 4,
                          padding: '2px 6px',
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: '0.4px',
                          color: '#a78bfa',
                          backdropFilter: 'blur(4px)',
                        }}
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            backgroundColor: '#a78bfa',
                            display: 'inline-block',
                          }}
                        />
                        FACECAM
                      </div>
                    </div>

                    {/* Headline Boxed Hook Banner at Exact Center Split Boundary */}
                    <div
                      id="streamer-split-headline-banner"
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        zIndex: 10,
                        maxWidth: '92%',
                        backgroundColor: '#ffffff',
                        border: '2px solid #ffffff',
                        borderRadius: 3,
                        padding: '4px 10px',
                        textAlign: 'center',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.85)',
                        pointerEvents: 'none',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'Impact', 'Arial Black', sans-serif",
                          fontSize: 11,
                          fontWeight: 900,
                          letterSpacing: '0.6px',
                          color: '#000000',
                          textTransform: 'uppercase',
                          display: 'block',
                          lineHeight: 1.15,
                        }}
                      >
                        {clipTitle || clip.hook || clip.title}
                      </span>
                    </div>

                    {/* Bottom Half: Gameplay Screen */}
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        height: '50%',
                        overflow: 'hidden',
                        backgroundColor: '#000000',
                      }}
                    >
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
                          objectFit: 'cover',
                          objectPosition: 'center center',
                          transform: isJumpCutMoment ? 'scale(1.18)' : 'scale(1.0)',
                          transition: 'none',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 8,
                          left: 8,
                          zIndex: 5,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          backgroundColor: 'rgba(9, 9, 11, 0.85)',
                          border: '1px solid rgba(16, 185, 129, 0.4)',
                          borderRadius: 4,
                          padding: '2px 6px',
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: '0.4px',
                          color: '#34d399',
                          backdropFilter: 'blur(4px)',
                        }}
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            backgroundColor: '#34d399',
                            display: 'inline-block',
                          }}
                        />
                        GAMEPLAY
                      </div>
                    </div>
                  </div>
                ) : (
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
                        objectFit:
                          aspectRatio === '16:9'
                            ? 'contain'
                            : cropMode === 'framed_headline'
                            ? 'contain'
                            : 'cover',
                        objectPosition:
                          aspectRatio === '16:9'
                            ? 'center center'
                            : cropMode === 'speaker_track'
                            ? activeSpeakerFocus === 'Speaker B'
                              ? `${Math.max(5, Math.min(95, 75 + framingOffsetX))}% 16%`
                              : `${Math.max(5, Math.min(95, 25 + framingOffsetX))}% 16%`
                            : `${Math.max(0, Math.min(100, Math.round(cropXPct * 100)))}% center`,
                        transform:
                          cropMode === 'speaker_track'
                            ? isJumpCutMoment
                              ? 'scale(1.15)'
                              : 'scale(1.0)'
                            : isJumpCutMoment
                            ? 'scale(1.20)'
                            : 'scale(1.0)',
                        transition:
                          cropMode === 'speaker_track'
                            ? 'object-position 0.28s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s ease-out'
                            : 'object-position 0.25s ease-in-out, transform 0.2s ease-out',
                      }}
                    />
                  </div>
                )}

                {/* Intro Thumbnail Hook Title (Detik 0.0 - 1.5s) — Clean Aesthetic, No Red Badges */}
                {introHookBanner && elapsedInClip >= 0 && elapsedInClip <= 1.5 && (
                  <div
                    id="live-intro-hook-banner"
                    style={{
                      position: 'absolute',
                      top: cropMode === 'streamer_split' ? '46%' : cropMode === 'framed_headline' ? '30%' : '14%',
                      left: '50%',
                      transform: 'translate(-50%, 0)',
                      zIndex: 12,
                      maxWidth: '90%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      pointerEvents: 'none',
                      opacity: elapsedInClip > 1.2 ? Math.max(0, (1.5 - elapsedInClip) / 0.3) : 1,
                      transition: 'opacity 0.15s ease-out',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Impact', 'Arial Black', sans-serif",
                        fontSize: 16,
                        fontWeight: 900,
                        letterSpacing: '0.8px',
                        color: '#ffffff',
                        textTransform: 'uppercase',
                        textAlign: 'center',
                        lineHeight: 1.15,
                        textShadow:
                          '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 4px 14px rgba(0,0,0,0.95)',
                      }}
                    >
                      {clipTitle || clip.hook || clip.title}
                    </span>
                  </div>
                )}

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
                      {activeSpeakerFocus === 'Speaker B'
                        ? 'Kamera: Speaker B (Kanan)'
                        : 'Kamera: Speaker A (Kiri)'}
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

                {/* Safe-Zone Grid HP Overlay (TikTok / Reels / Shorts UI Safe-Zones) */}
                {showSafeZone && (
                  <div
                    id="safe-zone-grid-overlay"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      pointerEvents: 'none',
                      zIndex: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    {/* Top System/Nav Safe-Zone */}
                    <div
                      style={{
                        height: '14%',
                        borderBottom: '1px dashed rgba(161, 161, 170, 0.4)',
                        backgroundColor: 'rgba(24, 24, 27, 0.25)',
                        padding: '6px 8px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
                        Area Navigasi Atas (Following | For You)
                      </span>
                      <span
                        style={{
                          fontSize: 8.5,
                          color: '#e4e4e7',
                          backgroundColor: 'rgba(0,0,0,0.6)',
                          padding: '1px 5px',
                          borderRadius: 3,
                          border: '1px solid rgba(255,255,255,0.15)',
                        }}
                      >
                        Safe-Zone HP
                      </span>
                    </div>

                    {/* Right Action Buttons Safe-Zone */}
                    <div
                      style={{
                        flex: 1,
                        display: 'flex',
                        justifyContent: 'flex-end',
                        alignItems: 'center',
                        paddingRight: 6,
                      }}
                    >
                      <div
                        style={{
                          width: '20%',
                          height: '75%',
                          border: '1px dashed rgba(239, 68, 68, 0.55)',
                          backgroundColor: 'rgba(239, 68, 68, 0.12)',
                          borderRadius: 6,
                          padding: '6px 4px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'space-around',
                        }}
                      >
                        <div style={{ textAlign: 'center' }}>
                          <span style={{ fontSize: 8, color: '#fca5a5', fontWeight: 700, display: 'block', lineHeight: 1.1 }}>
                            ZONA KANAN
                          </span>
                          <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.7)', display: 'block', marginTop: 2 }}>
                            (Like, Komen, Share)
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: 0.75 }}>
                          <div style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.25)', margin: '0 auto' }} />
                          <div style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.25)', margin: '0 auto' }} />
                          <div style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.25)', margin: '0 auto' }} />
                        </div>
                      </div>
                    </div>

                    {/* Bottom Caption & Audio Safe-Zone */}
                    <div
                      style={{
                        height: '24%',
                        borderTop: '1px dashed rgba(245, 158, 11, 0.55)',
                        backgroundColor: 'rgba(245, 158, 11, 0.12)',
                        padding: '6px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 8.5, color: '#fde047', fontWeight: 700 }}>
                          ⚠️ Area UI Bawah (Username, Caption & Sound)
                        </span>
                        <span style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.8)' }}>
                          MarginV: 320 (Aman)
                        </span>
                      </div>
                      <p style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.2 }}>
                        Subtitle diposisikan otomatis di atas area kuning ini agar tidak tertutup teks judul & musik TikTok/Shorts.
                      </p>
                    </div>
                  </div>
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

                {/* Interactive Reframe Grid Overlay (Rule of Thirds 3x3) */}
                {aspectRatio !== '16:9' && showReframeGrid && (
                  <div
                    id="interactive-reframe-grid-overlay"
                    onPointerDown={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setIsDraggingCrop(true);
                      const newPct = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
                      setCropXPct(Number(newPct.toFixed(3)));
                    }}
                    onPointerMove={(e) => {
                      if (!isDraggingCrop) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const newPct = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
                      setCropXPct(Number(newPct.toFixed(3)));
                    }}
                    onPointerUp={(e) => {
                      if (isDraggingCrop) {
                        setIsDraggingCrop(false);
                        try {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        } catch {}
                      }
                    }}
                    onPointerCancel={() => setIsDraggingCrop(false)}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      zIndex: 6,
                      cursor: isDraggingCrop ? 'grabbing' : 'grab',
                      touchAction: 'none',
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr',
                      gridTemplateRows: '1fr 1fr 1fr',
                      pointerEvents: 'auto',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                      backgroundColor: isDraggingCrop ? 'rgba(16, 185, 129, 0.04)' : 'transparent',
                      transition: 'background-color 0.15s ease',
                    }}
                    title="Klik dan geser secara horizontal untuk mengatur posisi fokus framing pembicara"
                  >
                    {/* 3x3 Grid Cells with Rule of Thirds Guidelines (Semi-transparan tipis border-zinc-500/20 dashed) */}
                    <div style={{ borderRight: '1px dashed rgba(113, 113, 122, 0.25)', borderBottom: '1px dashed rgba(113, 113, 122, 0.25)' }} />
                    <div style={{ borderRight: '1px dashed rgba(113, 113, 122, 0.25)', borderBottom: '1px dashed rgba(113, 113, 122, 0.25)' }} />
                    <div style={{ borderBottom: '1px dashed rgba(113, 113, 122, 0.25)' }} />
                    <div style={{ borderRight: '1px dashed rgba(113, 113, 122, 0.25)', borderBottom: '1px dashed rgba(113, 113, 122, 0.25)' }} />
                    <div style={{ borderRight: '1px dashed rgba(113, 113, 122, 0.25)', borderBottom: '1px dashed rgba(113, 113, 122, 0.25)' }} />
                    <div style={{ borderBottom: '1px dashed rgba(113, 113, 122, 0.25)' }} />
                    <div style={{ borderRight: '1px dashed rgba(113, 113, 122, 0.25)' }} />
                    <div style={{ borderRight: '1px dashed rgba(113, 113, 122, 0.25)' }} />
                    <div />

                    {/* 4 Golden Intersection Mini Dots */}
                    <div
                      style={{
                        position: 'absolute',
                        top: '33.33%',
                        left: '33.33%',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: '#f59e0b',
                        boxShadow: '0 0 6px rgba(245, 158, 11, 0.9)',
                        transform: 'translate(-50%, -50%)',
                        pointerEvents: 'none',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        top: '33.33%',
                        left: '66.67%',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: '#f59e0b',
                        boxShadow: '0 0 6px rgba(245, 158, 11, 0.9)',
                        transform: 'translate(-50%, -50%)',
                        pointerEvents: 'none',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        top: '66.67%',
                        left: '33.33%',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: '#f59e0b',
                        boxShadow: '0 0 6px rgba(245, 158, 11, 0.9)',
                        transform: 'translate(-50%, -50%)',
                        pointerEvents: 'none',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        top: '66.67%',
                        left: '66.67%',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: '#f59e0b',
                        boxShadow: '0 0 6px rgba(245, 158, 11, 0.9)',
                        transform: 'translate(-50%, -50%)',
                        pointerEvents: 'none',
                      }}
                    />

                    {/* Top Focus Badge */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 10,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        backgroundColor: 'rgba(9, 9, 11, 0.9)',
                        border: '1px solid rgba(16, 185, 129, 0.4)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                        color: '#f4f4f5',
                        padding: '3px 10px',
                        borderRadius: 9999,
                        fontSize: 10,
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
                      }}
                    >
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: '50%',
                          backgroundColor: '#10b981',
                          boxShadow: '0 0 6px #10b981',
                        }}
                      />
                      <span style={{ color: '#34d399' }}>◄ Drag Horizontal ►</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>Fokus: {Math.round(cropXPct * 100)}%</span>
                    </div>

                    {/* Center Focus Reticle with Crosshair & Aperture Ring */}
                    <div
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: `${Math.max(8, Math.min(92, Math.round(cropXPct * 100)))}%`,
                        transform: 'translate(-50%, -50%)',
                        pointerEvents: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: isDraggingCrop ? 'none' : 'left 0.15s ease',
                      }}
                    >
                      {/* Outer Reticle Ring */}
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          border: '2px solid #10b981',
                          backgroundColor: 'rgba(16, 185, 129, 0.18)',
                          boxShadow: '0 0 12px rgba(16, 185, 129, 0.75)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                        }}
                      >
                        {/* Center Target Dot */}
                        <div
                          style={{
                            width: 4,
                            height: 4,
                            borderRadius: '50%',
                            backgroundColor: '#ffffff',
                          }}
                        />
                      </div>
                    </div>
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
                    zIndex: 7,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = isPlaying ? '0' : '0.9')}
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
                </button>

                {/* Hidden Audio Elements for Audition & Ambient Video Sync */}
                <audio
                  ref={auditionAudioRef}
                  onEnded={() => setAuditioningSoundId(null)}
                  style={{ display: 'none' }}
                />
                <audio
                  ref={bgmPlayerRef}
                  loop
                  style={{ display: 'none' }}
                />
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

            {/* Minimalist Floating Playback Control Bar */}
            <div
              id="floating-playback-bar"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 14px',
                backgroundColor: 'rgba(18, 18, 20, 0.92)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                borderRadius: 9999,
                border: '1px solid #27272a',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  id="btn-loop-clip-play"
                  className={isPlaying ? 'btn btn-secondary' : 'btn btn-ghost'}
                  style={{
                    fontSize: 11,
                    padding: '4px 10px',
                    height: 28,
                    borderRadius: 9999,
                    backgroundColor: isPlaying ? 'rgba(16, 185, 129, 0.15)' : '#18181b',
                    border: isPlaying ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid #27272a',
                    color: isPlaying ? '#34d399' : '#f4f4f5',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={togglePlayPause}
                >
                  {isPlaying ? <Pause size={12} /> : <Play size={12} fill="currentColor" />}
                  {isPlaying ? 'Pause' : 'Loop Klip'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{
                    fontSize: 11,
                    padding: '4px 10px',
                    height: 28,
                    borderRadius: 9999,
                    color: '#a1a1aa',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#f4f4f5';
                    e.currentTarget.style.backgroundColor = '#18181b';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#a1a1aa';
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
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
                  <RotateCcw size={11} />
                  Restart
                </button>
              </div>

              {/* Timecode Badge */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 9px',
                  borderRadius: 6,
                  backgroundColor: '#141416',
                  border: '1px solid #27272a',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                }}
              >
                <span style={{ color: '#10b981', fontWeight: 600 }}>
                  {formatTime(currentPlayTime)}
                </span>
                <span style={{ color: '#52525b' }}>/</span>
                <span style={{ color: '#a1a1aa' }}>
                  {formatTime(trimEnd)}
                </span>
              </div>
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
            {activeStudioTab === 'distribution' ? (
              <div
                id="social-publishing-suite-panel"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                {/* 1-Click Creator Export Kit Card */}
                <div
                  id="export-kit-card"
                  style={{
                    backgroundColor: '#121214',
                    border: '1px solid #27272a',
                    borderRadius: 8,
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          backgroundColor: 'rgba(16, 185, 129, 0.15)',
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Archive size={15} color="#10b981" />
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                          1-Click Publishing Kit (.zip)
                        </div>
                        <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                          Video MP4 9:16 + Cover Feed JPG + Teks Copywriting TXT
                        </div>
                      </div>
                    </div>

                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 4,
                        backgroundColor: isCompleted ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                        border: isCompleted ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)',
                        color: isCompleted ? '#34d399' : '#fbbf24',
                      }}
                    >
                      {isCompleted ? 'Siap Unduh' : 'Perlu Render MP4'}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr',
                      gap: 8,
                      backgroundColor: '#18181b',
                      padding: '10px',
                      borderRadius: 6,
                      border: '1px solid #27272a',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 10, color: '#71717a' }}>Video Vertikal</span>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: isCompleted ? '#34d399' : '#a1a1aa' }}>
                        {isCompleted ? '✓ MP4 1080x1920' : '⏳ Belum dirender'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 10, color: '#71717a' }}>Feed Cover</span>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: '#34d399' }}>
                        ✓ JPG 1080x1920
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 10, color: '#71717a' }}>Copywriting</span>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: socialCopies ? '#34d399' : '#fbbf24' }}>
                        {socialCopies ? '✓ 3 Platform' : '⏳ Auto-generate'}
                      </span>
                    </div>
                  </div>

                  <button
                    id="btn-download-kit-studio-action"
                    type="button"
                    style={{
                      width: '100%',
                      height: 36,
                      backgroundColor: isCompleted ? '#10b981' : '#27272a',
                      color: isCompleted ? '#ffffff' : '#71717a',
                      border: 'none',
                      borderRadius: 6,
                      fontWeight: 600,
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      cursor: isCompleted && !isDownloadingKit ? 'pointer' : 'not-allowed',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={handleDownloadPublishingKit}
                    disabled={!isCompleted || isDownloadingKit}
                  >
                    {isDownloadingKit ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Archive size={14} />
                    )}
                    {isDownloadingKit
                      ? 'Mengompresi Paket ZIP...'
                      : isCompleted
                      ? 'Unduh Paket Klip (MP4 + Cover JPG)'
                      : 'Render MP4 di Tab Editor untuk Unduh Kit'}
                  </button>
                </div>

                {/* AI Social Media Copywriter Section */}
                <div
                  id="social-copywriter-card"
                  style={{
                    backgroundColor: '#121214',
                    border: '1px solid #27272a',
                    borderRadius: 8,
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Sparkles size={14} color="#f59e0b" />
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                        AI Social Media Copywriter
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 600,
                        color: '#a1a1aa',
                        backgroundColor: '#18181b',
                        padding: '1px 6px',
                        borderRadius: 4,
                        border: '1px solid #27272a',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: '50%',
                          backgroundColor: '#10b981',
                        }}
                      />
                      Gemini Flash / Offline Fallback
                    </span>
                  </div>

                  {/* Platform Switcher Pills */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr',
                      gap: 6,
                      backgroundColor: '#18181b',
                      padding: 4,
                      borderRadius: 6,
                      border: '1px solid #27272a',
                    }}
                  >
                    <button
                      type="button"
                      id="platform-tab-tiktok"
                      onClick={() => setActiveSocialPlatform('tiktok')}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2,
                        padding: '6px 4px',
                        borderRadius: 4,
                        border: 'none',
                        backgroundColor: activeSocialPlatform === 'tiktok' ? '#27272a' : 'transparent',
                        color: activeSocialPlatform === 'tiktok' ? '#f4f4f5' : '#71717a',
                        fontWeight: activeSocialPlatform === 'tiktok' ? 700 : 500,
                        fontSize: 11,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span>📱 TikTok</span>
                      <span style={{ fontSize: 9, color: '#a1a1aa' }}>Hook & FYP</span>
                    </button>

                    <button
                      type="button"
                      id="platform-tab-shorts"
                      onClick={() => setActiveSocialPlatform('shorts')}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2,
                        padding: '6px 4px',
                        borderRadius: 4,
                        border: 'none',
                        backgroundColor: activeSocialPlatform === 'shorts' ? '#27272a' : 'transparent',
                        color: activeSocialPlatform === 'shorts' ? '#f4f4f5' : '#71717a',
                        fontWeight: activeSocialPlatform === 'shorts' ? 700 : 500,
                        fontSize: 11,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span>▶️ YouTube Shorts</span>
                      <span style={{ fontSize: 9, color: '#a1a1aa' }}>SEO & Search</span>
                    </button>

                    <button
                      type="button"
                      id="platform-tab-reels"
                      onClick={() => setActiveSocialPlatform('reels')}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2,
                        padding: '6px 4px',
                        borderRadius: 4,
                        border: 'none',
                        backgroundColor: activeSocialPlatform === 'reels' ? '#27272a' : 'transparent',
                        color: activeSocialPlatform === 'reels' ? '#f4f4f5' : '#71717a',
                        fontWeight: activeSocialPlatform === 'reels' ? 700 : 500,
                        fontSize: 11,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span>📸 Instagram Reels</span>
                      <span style={{ fontSize: 9, color: '#a1a1aa' }}>Aesthetic & CTA</span>
                    </button>
                  </div>

                  {/* Variation / Topic Input & Action Bar */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="text"
                      id="input-social-copy-topic"
                      value={customSocialTopic}
                      onChange={(e) => setCustomSocialTopic(e.target.value)}
                      placeholder="Variasi sudut pandang (opsional: misal 'buat lebih kontroversial / lucu')..."
                      style={{
                        flex: 1,
                        backgroundColor: '#18181b',
                        border: '1px solid #27272a',
                        borderRadius: 6,
                        padding: '7px 10px',
                        color: '#f4f4f5',
                        fontSize: 11.5,
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          loadSocialCopies(true, activeSocialPlatform);
                        }
                      }}
                    />
                    <button
                      id="btn-generate-platform-copy"
                      type="button"
                      style={{
                        backgroundColor: '#27272a',
                        border: '1px solid #3f3f46',
                        color: '#f4f4f5',
                        borderRadius: 6,
                        padding: '7px 12px',
                        fontSize: 11.5,
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: isGeneratingSocialCopy ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                      onClick={() => loadSocialCopies(true, activeSocialPlatform)}
                      disabled={isGeneratingSocialCopy}
                    >
                      {isGeneratingSocialCopy ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <RefreshCw size={13} color="#f59e0b" />
                      )}
                      <span>Generate Ulang Teks AI</span>
                    </button>
                  </div>

                  {/* Social Error Display */}
                  {socialError && (
                    <div
                      style={{
                        padding: '8px 12px',
                        borderRadius: 6,
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#f87171',
                        fontSize: 11.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <AlertCircle size={14} />
                      <span>{socialError}</span>
                    </div>
                  )}

                  {/* Loading State */}
                  {(isLoadingSocialCopy || isGeneratingSocialCopy) && (
                    <div
                      style={{
                        padding: '24px 16px',
                        backgroundColor: '#18181b',
                        borderRadius: 6,
                        border: '1px solid #27272a',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                      }}
                    >
                      <Loader2 size={20} className="animate-spin" color="#f59e0b" />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#f4f4f5' }}>
                        {isGeneratingSocialCopy
                          ? 'AI sedang merancang copywriting viral...'
                          : 'Memuat data teks media sosial...'}
                      </span>
                      <span style={{ fontSize: 10.5, color: '#71717a' }}>
                        Menganalisis transkrip klip, struktur hook, tagar tren, dan pemicu interaksi
                      </span>
                    </div>
                  )}

                  {/* Content View when Social Copy is Available */}
                  {!isLoadingSocialCopy && !isGeneratingSocialCopy && socialCopies && socialCopies[activeSocialPlatform] ? (
                    (() => {
                      const copy = socialCopies[activeSocialPlatform];
                      const isFullCopied = copiedKey === `${activeSocialPlatform}_full`;
                      const isTitleCopied = copiedKey === `${activeSocialPlatform}_title`;
                      const isCaptionCopied = copiedKey === `${activeSocialPlatform}_caption`;
                      const isTagsCopied = copiedKey === `${activeSocialPlatform}_tags`;
                      const isCtaCopied = copiedKey === `${activeSocialPlatform}_cta`;

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {/* 1. Title / Hook Card */}
                          <div
                            style={{
                              backgroundColor: '#18181b',
                              border: '1px solid #27272a',
                              borderRadius: 6,
                              padding: '10px 12px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#a1a1aa' }}>
                                {activeSocialPlatform === 'shorts'
                                  ? 'JUDUL SEO YOUTUBE (<60 KARAKTER)'
                                  : 'HOOK 1-BARIS MEMANCING PENASARAN'}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopyToClipboard(copy.title, `${activeSocialPlatform}_title`)}
                                style={{
                                  backgroundColor: 'transparent',
                                  border: 'none',
                                  color: isTitleCopied ? '#34d399' : '#a1a1aa',
                                  fontSize: 10.5,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                              >
                                {isTitleCopied ? <Check size={12} /> : <Copy size={12} />}
                                {isTitleCopied ? 'Tersalin' : 'Salin'}
                              </button>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                              {copy.title}
                            </div>
                          </div>

                          {/* 2. Caption Card */}
                          <div
                            style={{
                              backgroundColor: '#18181b',
                              border: '1px solid #27272a',
                              borderRadius: 6,
                              padding: '10px 12px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#a1a1aa' }}>
                                {activeSocialPlatform === 'tiktok'
                                  ? 'CAPTION SINGKAT FYP (MAKS 150 KARAKTER)'
                                  : activeSocialPlatform === 'shorts'
                                  ? 'DESKRIPSI PADAT KATA KUNCI PENCARIAN'
                                  : 'CAPTION MICRO-BLOGGING ESTETIK'}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopyToClipboard(copy.caption, `${activeSocialPlatform}_caption`)}
                                style={{
                                  backgroundColor: 'transparent',
                                  border: 'none',
                                  color: isCaptionCopied ? '#34d399' : '#a1a1aa',
                                  fontSize: 10.5,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                              >
                                {isCaptionCopied ? <Check size={12} /> : <Copy size={12} />}
                                {isCaptionCopied ? 'Tersalin' : 'Salin'}
                              </button>
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: '#e4e4e7',
                                whiteSpace: 'pre-wrap',
                                lineHeight: '1.5',
                              }}
                            >
                              {copy.caption}
                            </div>
                          </div>

                          {/* 3. Hashtags Card */}
                          <div
                            style={{
                              backgroundColor: '#18181b',
                              border: '1px solid #27272a',
                              borderRadius: 6,
                              padding: '10px 12px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#a1a1aa' }}>
                                {activeSocialPlatform === 'tiktok'
                                  ? '4 TAGAR TREN RELEVAN'
                                  : activeSocialPlatform === 'shorts'
                                  ? '3 TAGAR UTAMA (#Shorts + TOPIK)'
                                  : '5 TAGAR TERTARGET REELS'}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopyToClipboard(copy.hashtags.join(' '), `${activeSocialPlatform}_tags`)}
                                style={{
                                  backgroundColor: 'transparent',
                                  border: 'none',
                                  color: isTagsCopied ? '#34d399' : '#a1a1aa',
                                  fontSize: 10.5,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                              >
                                {isTagsCopied ? <Check size={12} /> : <Copy size={12} />}
                                {isTagsCopied ? 'Tersalin' : 'Salin Semua'}
                              </button>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {copy.hashtags.map((tag, i) => (
                                <span
                                  key={i}
                                  onClick={() => handleCopyToClipboard(tag, `tag_${tag}`)}
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: '#38bdf8',
                                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                    border: '1px solid rgba(56, 189, 248, 0.25)',
                                    cursor: 'pointer',
                                  }}
                                  title="Klik untuk menyalin tagar ini"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* 4. CTA / Pertanyaan Pemicu Komentar */}
                          <div
                            style={{
                              backgroundColor: '#18181b',
                              border: '1px solid #27272a',
                              borderRadius: 6,
                              padding: '10px 12px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#a1a1aa' }}>
                                {activeSocialPlatform === 'tiktok'
                                  ? 'PERTANYAAN PEMICU KOMENTAR'
                                  : 'CALL-TO-ACTION (CTA) INTERAKSI'}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopyToClipboard(copy.cta, `${activeSocialPlatform}_cta`)}
                                style={{
                                  backgroundColor: 'transparent',
                                  border: 'none',
                                  color: isCtaCopied ? '#34d399' : '#a1a1aa',
                                  fontSize: 10.5,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                              >
                                {isCtaCopied ? <Check size={12} /> : <Copy size={12} />}
                                {isCtaCopied ? 'Tersalin' : 'Salin'}
                              </button>
                            </div>
                            <div style={{ fontSize: 12, color: '#f4f4f5', fontStyle: 'italic' }}>
                              "{copy.cta}"
                            </div>
                          </div>

                          {/* 5. Siap Post Preview & Big Copy Button */}
                          <div
                            style={{
                              backgroundColor: '#000000',
                              border: '1px solid #3f3f46',
                              borderRadius: 8,
                              padding: '12px 14px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 10,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#f4f4f5' }}>
                                Pratinjau Teks Siap Post
                              </span>
                              <span style={{ fontSize: 9.5, color: '#71717a' }}>
                                Format siap tempel ke aplikasi
                              </span>
                            </div>

                            <div
                              style={{
                                backgroundColor: '#09090b',
                                border: '1px solid #27272a',
                                borderRadius: 6,
                                padding: '10px',
                                fontSize: 11.5,
                                color: '#d4d4d8',
                                whiteSpace: 'pre-wrap',
                                lineHeight: '1.55',
                                maxHeight: 180,
                                overflowY: 'auto',
                                fontFamily: 'inherit',
                              }}
                            >
                              {copy.full_formatted_text}
                            </div>

                            <button
                              id="btn-copy-full-text-studio"
                              type="button"
                              style={{
                                width: '100%',
                                padding: '10px 14px',
                                borderRadius: 6,
                                backgroundColor: isFullCopied ? '#065f46' : '#27272a',
                                border: isFullCopied ? '1px solid #10b981' : '1px solid #3f3f46',
                                color: isFullCopied ? '#34d399' : '#f4f4f5',
                                fontWeight: 600,
                                fontSize: 12.5,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8,
                                transition: 'all 0.2s ease',
                                cursor: 'pointer',
                              }}
                              onClick={() => handleCopyToClipboard(copy.full_formatted_text, `${activeSocialPlatform}_full`)}
                            >
                              {isFullCopied ? (
                                <>
                                  <CheckCircle2 size={16} color="#34d399" />
                                  <span>Tersalin ke Clipboard!</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={15} />
                                  <span>Salin Teks Lengkap</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })()
                  ) : !isLoadingSocialCopy && !isGeneratingSocialCopy ? (
                    <div
                      style={{
                        padding: '24px 16px',
                        backgroundColor: '#18181b',
                        borderRadius: 6,
                        border: '1px solid #27272a',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                        textAlign: 'center',
                      }}
                    >
                      <Sparkles size={24} color="#f59e0b" />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                          Belum Ada Copywriting untuk Klip Ini
                        </div>
                        <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 4 }}>
                          Buat teks siap posting untuk TikTok, YouTube Shorts, dan Instagram Reels secara otomatis.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{
                          fontSize: 12,
                          padding: '8px 16px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                        onClick={() => loadSocialCopies(true, 'all')}
                      >
                        <Sparkles size={14} />
                        Generate Copywriting AI Sekarang
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                {/* Judul & SEO Title Analyzer Panel (Ala Rank Math / Yoast SEO) */}
            <div
              id="seo-title-analyzer-panel"
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 8,
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <TrendingUp size={14} color="#10b981" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                    Judul & SEO Score
                  </span>
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: '#a1a1aa',
                      backgroundColor: '#18181b',
                      padding: '1px 6px',
                      borderRadius: 4,
                      border: '1px solid #27272a',
                    }}
                  >
                    Rank Math Engine
                  </span>
                </div>

                {/* Dynamic Score Indicator Badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isAnalyzingSeo && (
                    <Loader2 size={12} className="animate-spin" style={{ color: '#a1a1aa' }} />
                  )}
                  {seoAnalysis ? (
                    <div
                      id="seo-score-badge"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 8px',
                        borderRadius: 6,
                        backgroundColor:
                          seoAnalysis.score >= 75
                            ? 'rgba(16, 185, 129, 0.15)'
                            : seoAnalysis.score >= 50
                            ? 'rgba(245, 158, 11, 0.15)'
                            : 'rgba(239, 68, 68, 0.15)',
                        border: `1px solid ${
                          seoAnalysis.score >= 75
                            ? '#10b981'
                            : seoAnalysis.score >= 50
                            ? '#f59e0b'
                            : '#ef4444'
                        }`,
                        color:
                          seoAnalysis.score >= 75
                            ? '#34d399'
                            : seoAnalysis.score >= 50
                            ? '#fbbf24'
                            : '#f87171',
                        fontSize: 11.5,
                        fontWeight: 700,
                      }}
                      title={`Status: ${seoAnalysis.rating.toUpperCase()}`}
                    >
                      <span>{seoAnalysis.score}</span>
                      <span style={{ fontSize: 9.5, opacity: 0.75 }}>/ 100</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: 10, color: '#71717a' }}>Skor: --</span>
                  )}
                </div>
              </div>

              {/* Title Interactive Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <input
                  id="clip-title-input"
                  type="text"
                  value={clipTitle}
                  onChange={(e) => setClipTitle(e.target.value)}
                  placeholder="Ketik judul klip yang bikin penasaran..."
                  style={{
                    backgroundColor: '#18181b',
                    border: '1px solid #27272a',
                    borderRadius: 6,
                    padding: '8px 10px',
                    color: '#f4f4f5',
                    fontSize: 12.5,
                    fontWeight: 600,
                    outline: 'none',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10 }}>
                  <span
                    style={{
                      color:
                        clipTitle.length >= 30 && clipTitle.length <= 65
                          ? '#10b981'
                          : clipTitle.length > 65
                          ? '#ef4444'
                          : '#a1a1aa',
                      fontWeight: 600,
                    }}
                  >
                    {clipTitle.length} / 65 karakter (Ideal: 30-65)
                  </span>

                  <button
                    id="btn-ai-recommendations"
                    type="button"
                    onClick={handleFetchRecommendations}
                    disabled={isLoadingRecommendations}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(59, 130, 246, 0.2))',
                      border: '1px solid rgba(168, 85, 247, 0.4)',
                      borderRadius: 4,
                      padding: '2px 8px',
                      color: '#d8b4fe',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: isLoadingRecommendations ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isLoadingRecommendations ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Sparkles size={10} />
                    )}
                    <span>Rekomendasi Judul AI</span>
                  </button>
                </div>
              </div>

              {/* AI Recommendations Drawer */}
              {showRecsDrawer && (
                <div
                  id="ai-recommendations-drawer"
                  style={{
                    backgroundColor: '#18181b',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    borderRadius: 6,
                    padding: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Sparkles size={12} color="#c084fc" />
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#f3e8ff' }}>
                        3 Saran Judul AI Ber-SEO Tinggi
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowRecsDrawer(false)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#71717a',
                        fontSize: 10,
                        cursor: 'pointer',
                      }}
                    >
                      Tutup
                    </button>
                  </div>

                  {isLoadingRecommendations ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#a1a1aa', fontSize: 11, padding: '8px 0' }}>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Meracik judul viral dengan AI...</span>
                    </div>
                  ) : recommendations.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {recommendations.map((rec, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            backgroundColor: '#121214',
                            border: '1px solid #27272a',
                            borderRadius: 6,
                            padding: '6px 10px',
                            gap: 8,
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#f4f4f5' }}>
                              {rec.title}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span
                                style={{
                                  fontSize: 9,
                                  color: '#34d399',
                                  fontWeight: 700,
                                }}
                              >
                                SEO: {rec.score}/100
                              </span>
                              <span
                                style={{
                                  fontSize: 8.5,
                                  color: '#a78bfa',
                                  backgroundColor: 'rgba(167, 139, 250, 0.1)',
                                  padding: '0 4px',
                                  borderRadius: 3,
                                  textTransform: 'uppercase',
                                }}
                              >
                                {rec.rating}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleApplyRecommendedTitle(rec.title)}
                            style={{
                              backgroundColor: '#27272a',
                              border: '1px solid #3f3f46',
                              color: '#e4e4e7',
                              fontSize: 10,
                              fontWeight: 600,
                              padding: '4px 8px',
                              borderRadius: 4,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#38bdf8';
                              e.currentTarget.style.color = '#000000';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = '#27272a';
                              e.currentTarget.style.color = '#e4e4e7';
                            }}
                          >
                            Gunakan
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: 11, color: '#71717a', margin: 0 }}>
                      Klik tombol Rekomendasi Judul AI untuk memuat saran.
                    </p>
                  )}
                </div>
              )}

              {/* Rank Math SEO Checklist Dropdown */}
              {seoAnalysis && (
                <div
                  style={{
                    border: '1px solid #27272a',
                    borderRadius: 6,
                    backgroundColor: '#18181b',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setIsChecklistExpanded((prev) => !prev)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      backgroundColor: '#18181b',
                      border: 'none',
                      color: '#e4e4e7',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#a1a1aa' }}>Checklist Kriteria SEO:</span>
                      <span
                        style={{
                          color:
                            seoAnalysis.checklist.filter((c: SEOCheckItem) => c.status === 'good').length ===
                            seoAnalysis.checklist.length
                              ? '#34d399'
                              : '#fbbf24',
                          fontWeight: 700,
                        }}
                      >
                        {seoAnalysis.checklist.filter((c: SEOCheckItem) => c.status === 'good').length} /{' '}
                        {seoAnalysis.checklist.length} Lulus
                      </span>
                    </div>
                    {isChecklistExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>

                  {isChecklistExpanded && (
                    <div
                      style={{
                        padding: '8px 10px 10px',
                        borderTop: '1px solid #27272a',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 7,
                      }}
                    >
                      {seoAnalysis.checklist.map((chk: SEOCheckItem, idx: number) => (
                        <div
                          key={chk.id || idx}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 8,
                            fontSize: 11,
                          }}
                        >
                          <div style={{ marginTop: 1, flexShrink: 0 }}>
                            {chk.status === 'good' ? (
                              <CheckCircle2 size={13} color="#10b981" />
                            ) : chk.status === 'warning' ? (
                              <AlertCircle size={13} color="#f59e0b" />
                            ) : (
                              <XCircle size={13} color="#ef4444" />
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontWeight: 600, color: '#f4f4f5' }}>
                                {chk.label}
                              </span>
                              <span style={{ fontSize: 9.5, color: '#71717a' }}>
                                +{chk.score}/{chk.max_score}
                              </span>
                            </div>
                            <span style={{ color: '#a1a1aa', fontSize: 10.5, lineHeight: 1.25 }}>
                              {chk.message}
                            </span>
                            {chk.status !== 'good' && chk.tip && (
                              <span style={{ color: '#fbbf24', fontSize: 10, fontStyle: 'italic', marginTop: 2 }}>
                                Tips: {chk.tip}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Dynamic Auto-Zoom Retention Engine Selector (3 Best Curated) */}
            <div
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 10,
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 5,
                      backgroundColor: 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Sparkles size={12} color="#10b981" />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                    Dynamic Auto-Zoom Retention Engine
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: '#a1a1aa',
                    backgroundColor: '#18181b',
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid #27272a',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  3 Pola Terkurasi
                </span>
              </div>
              <p style={{ fontSize: 11, color: '#a1a1aa', margin: 0, lineHeight: 1.4 }}>
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
                  { id: 'snap_hook', label: 'Jump-Cut Pacing (FYP)', badge: '1.20x Hard Cut', desc: 'Lompat instan 1.20x tiap 5s (durasi 2s) ala konten FYP' },
                  { id: 'subtle', label: 'Subtle Pacing', badge: '1.12x Cut', desc: 'Jump-cut ritmik lebih halus per 5 detik' },
                ].map((item) => {
                  const isSelected = autoZoom === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      id={`zoom-option-${item.id}`}
                      onClick={() => setAutoZoom(item.id as AutoZoom)}
                      style={{
                        padding: '10px 10px',
                        borderRadius: 8,
                        border: isSelected ? '1px solid #10b981' : '1px solid #27272a',
                        backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.06)' : '#141416',
                        color: isSelected ? '#f4f4f5' : '#71717a',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        transition: 'all 0.15s ease',
                        boxShadow: isSelected ? '0 0 10px rgba(16, 185, 129, 0.12)' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11.5, fontWeight: isSelected ? 700 : 600, color: isSelected ? '#f4f4f5' : '#a1a1aa' }}>
                          {item.label}
                        </span>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 4,
                            backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.18)' : '#18181b',
                            color: isSelected ? '#34d399' : '#71717a',
                            border: isSelected ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid #27272a',
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

            {/* Intro Hook Banner (Detik 0–3) Toggle Card */}
            <div
              id="intro-hook-banner-card"
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 10,
                padding: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Type size={14} color="#facc15" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                    Tampilkan Hook Banner Awal (3 Detik)
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      backgroundColor: 'rgba(250, 204, 21, 0.15)',
                      border: '1px solid rgba(250, 204, 21, 0.3)',
                      color: '#facc15',
                      padding: '1px 5px',
                      borderRadius: 3,
                    }}
                  >
                    Detik 0–3
                  </span>
                </div>
                <span style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.3 }}>
                  Render kotak judul hook tebal di awal video (detik 0.0 - 3.0) lalu menghilang halus untuk memaksimalkan retensi 3 detik pertama.
                </span>
              </div>

              <button
                type="button"
                id="toggle-intro-hook-banner"
                onClick={() => setIntroHookBanner(!introHookBanner)}
                style={{
                  width: 40,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: introHookBanner ? '#facc15' : '#27272a',
                  border: 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  padding: 2,
                  transition: 'background-color 0.2s ease',
                  flexShrink: 0,
                }}
                title={introHookBanner ? 'Matikan Banner Hook Awal' : 'Aktifkan Banner Hook Awal'}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    backgroundColor: introHookBanner ? '#09090b' : '#71717a',
                    transform: introHookBanner ? 'translateX(18px)' : 'translateX(0)',
                    transition: 'transform 0.2s ease',
                  }}
                />
              </button>
            </div>

            {/* Smart Silence Removal (Jump-Cut) Toggle Card */}
            <div
              id="silence-removal-card"
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 10,
                padding: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Scissors size={14} color="#f43f5e" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                    Buang Jeda Hening (Silence Removal)
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      backgroundColor: 'rgba(244, 63, 94, 0.15)',
                      border: '1px solid rgba(244, 63, 94, 0.3)',
                      color: '#fb7185',
                      padding: '1px 5px',
                      borderRadius: 3,
                    }}
                  >
                    Smart Jump-Cut
                  </span>
                </div>
                <span style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.3 }}>
                  Deteksi otomatis jeda hening (&gt;0.5s pada -30dB) menggunakan FFmpeg silencedetect dan potong secara mulus untuk meningkatkan retensi penonton.
                </span>
              </div>

              <button
                type="button"
                id="toggle-silence-removal"
                onClick={() => setRemoveSilence(!removeSilence)}
                style={{
                  width: 40,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: removeSilence ? '#f43f5e' : '#27272a',
                  border: 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  padding: 2,
                  transition: 'background-color 0.2s ease',
                  flexShrink: 0,
                }}
                title={removeSilence ? 'Nonaktifkan Buang Jeda Hening' : 'Aktifkan Buang Jeda Hening'}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    backgroundColor: removeSilence ? '#ffffff' : '#71717a',
                    transform: removeSilence ? 'translateX(18px)' : 'translateX(0)',
                    transition: 'transform 0.2s ease',
                  }}
                />
              </button>
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
                  5 Mode Terpilih
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
                  { id: 'streamer_split', label: 'Streamer Split (Facecam + Game)', desc: 'Facecam streamer di atas, layar game di bawah', badge: 'Gaming' },
                ].map((item) => {
                  const isSelected = cropMode === item.id;
                  const isGaming = item.id === 'streamer_split';
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
                        gridColumn: isGaming ? '1 / -1' : undefined,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          {isGaming && <Gamepad2 size={12} color={isSelected ? '#a78bfa' : '#71717a'} />}
                          <span style={{ fontSize: 11.5, fontWeight: 600 }}>{item.label}</span>
                        </div>
                        {'badge' in item && (
                          <span
                            style={{
                              fontSize: 8.5,
                              fontWeight: 700,
                              padding: '1px 4px',
                              borderRadius: 3,
                              backgroundColor: isGaming
                                ? isSelected
                                  ? 'rgba(167, 139, 250, 0.2)'
                                  : '#18181b'
                                : isSelected
                                ? 'rgba(56, 189, 248, 0.2)'
                                : '#18181b',
                              color: isGaming
                                ? isSelected
                                  ? '#c084fc'
                                  : '#a1a1aa'
                                : isSelected
                                ? '#38bdf8'
                                : '#71717a',
                              border: isGaming
                                ? isSelected
                                  ? '1px solid #c084fc'
                                  : '1px solid #27272a'
                                : isSelected
                                ? '1px solid #38bdf8'
                                : '1px solid #27272a',
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

              {/* Offset Horizontal Framing Slider & SFX Controls */}
              <div
                style={{
                  backgroundColor: '#18181b',
                  border: '1px solid #27272a',
                  borderRadius: 6,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  marginTop: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Sliders size={13} color="#a1a1aa" />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: '#f4f4f5' }}>
                      Offset Horizontal Framing (Koreksi Geser Kamera)
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: framingOffsetX === 0 ? '#a1a1aa' : framingOffsetX > 0 ? '#38bdf8' : '#eab308',
                        backgroundColor: '#121214',
                        padding: '1px 6px',
                        borderRadius: 3,
                        border: '1px solid #27272a',
                      }}
                    >
                      {framingOffsetX === 0 ? '0% (Tengah)' : framingOffsetX > 0 ? `+${framingOffsetX}% (Kanan)` : `${framingOffsetX}% (Kiri)`}
                    </span>
                    {framingOffsetX !== 0 && (
                      <button
                        type="button"
                        onClick={() => setFramingOffsetX(0)}
                        style={{
                          fontSize: 9.5,
                          color: '#a1a1aa',
                          backgroundColor: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          padding: 0,
                        }}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, color: '#71717a' }}>-25%</span>
                  <input
                    type="range"
                    min={-25}
                    max={25}
                    step={1}
                    value={framingOffsetX}
                    onChange={(e) => setFramingOffsetX(Number(e.target.value))}
                    style={{
                      flex: 1,
                      accentColor: '#38bdf8',
                      cursor: 'pointer',
                    }}
                  />
                  <span style={{ fontSize: 10, color: '#71717a' }}>+25%</span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 6,
                    borderTop: '1px solid #27272a',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      color: '#e4e4e7',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={enableSfx}
                      onChange={(e) => setEnableSfx(e.target.checked)}
                      style={{ accentColor: '#38bdf8', cursor: 'pointer' }}
                    />
                    <span>Audio Polish & Sound Effects (Whoosh & Pop SFX)</span>
                  </label>
                  <span
                    style={{
                      fontSize: 8.5,
                      fontWeight: 700,
                      color: enableSfx ? '#34d399' : '#71717a',
                      backgroundColor: '#121214',
                      padding: '1px 5px',
                      borderRadius: 3,
                      border: '1px solid #27272a',
                    }}
                  >
                    {enableSfx ? 'SFX ON' : 'SFX OFF'}
                  </span>
                </div>
              </div>
            </div>

            {/* Viral Subtitle Typography Presets */}
            <div
              id="subtitle-editor-panel"
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 10,
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
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
                    label: 'Cyber Neon (Electric Lime)',
                    preview: 'ELECTRIC LIME',
                    font: 'Arial Black',
                    color: '#FFFFFF',
                    glow: '0 0 8px #CCFF00',
                    desc: 'Putih pekat aksen Electric Lime (#CCFF00) border 4.0',
                  },
                  {
                    id: 'word_highlight',
                    label: 'Word Highlight (Punch Pop)',
                    preview: 'PUNCH POP',
                    font: 'Impact',
                    color: '#FFE500',
                    desc: 'Potongan 3-4 kata, aktif menyala Kuning Neon berirama',
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
                      className="preset-subtitle-card"
                      onClick={() => setSubtitleStyle(item.id as SubtitleStyle)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: isSelected
                          ? '1px solid #10b981'
                          : '1px solid #27272a',
                        backgroundColor: isSelected
                          ? 'rgba(16, 185, 129, 0.06)'
                          : '#141416',
                        boxShadow: isSelected
                          ? '0 0 12px rgba(16, 185, 129, 0.15), inset 0 1px 0 rgba(16, 185, 129, 0.2)'
                          : 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        position: 'relative',
                        transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: isSelected ? '#f4f4f5' : '#a1a1aa' }}>
                          {item.label}
                        </span>
                        {isSelected ? (
                          <span
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              backgroundColor: '#10b981',
                              color: '#09090b',
                              boxShadow: '0 0 8px rgba(16, 185, 129, 0.6)',
                              flexShrink: 0,
                            }}
                          >
                            <Check size={10} strokeWidth={3} />
                          </span>
                        ) : (
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
                              opacity: 0.85,
                            }}
                          >
                            {item.preview}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 9.5, color: isSelected ? '#a1a1aa' : '#71717a', lineHeight: 1.3 }}>
                        {item.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Auto-Emoji Subtitle Injector Toggle Card */}
            <div
              id="auto-emoji-subtitles-card"
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 10,
                padding: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={14} color="#f59e0b" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                    Auto-Emoji Subtitle Injector
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      backgroundColor: 'rgba(245, 158, 11, 0.15)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      color: '#fbbf24',
                      padding: '1px 5px',
                      borderRadius: 3,
                    }}
                  >
                    💸 😱 🔥 😂 💡
                  </span>
                </div>
                <span style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.3 }}>
                  Sisipkan emoji dinamis otomatis pada kata kunci kontekstual (cuan 💸, kaget 😱, viral 🔥, lucu 😂, ide 💡) di dalam subtitle karaoke ASS tanpa merusak timing kata.
                </span>
              </div>

              <button
                type="button"
                id="toggle-auto-emoji"
                onClick={() => setAutoEmoji(!autoEmoji)}
                style={{
                  width: 40,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: autoEmoji ? '#f59e0b' : '#27272a',
                  border: 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  padding: 2,
                  transition: 'background-color 0.2s ease',
                  flexShrink: 0,
                }}
                title={autoEmoji ? 'Nonaktifkan Auto-Emoji' : 'Aktifkan Auto-Emoji'}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    backgroundColor: autoEmoji ? '#09090b' : '#71717a',
                    transform: autoEmoji ? 'translateX(18px)' : 'translateX(0)',
                    transition: 'transform 0.2s ease',
                  }}
                />
              </button>
            </div>

            {/* Meme Soundboard & Reaction SFX Engine Studio */}
            <div
              id="soundboard-sfx-panel"
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 10,
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Volume2 size={15} color="#fbbf24" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>
                    Meme Soundboard & Reaction SFX
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isLoadingSoundboard && (
                    <Loader2 size={12} className="spinner" style={{ color: '#fbbf24' }} />
                  )}
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      color: soundboardCues.length > 0 ? '#fbbf24' : '#71717a',
                      backgroundColor: soundboardCues.length > 0 ? 'rgba(245, 158, 11, 0.15)' : '#18181b',
                      border: soundboardCues.length > 0 ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid #27272a',
                      padding: '2px 7px',
                      borderRadius: 4,
                    }}
                  >
                    {soundboardCues.length > 0 ? `${soundboardCues.length} SFX Aktif` : '0 SFX Aktif'}
                  </span>
                </div>
              </div>

              <p style={{ fontSize: 11, color: '#a1a1aa', margin: 0, lineHeight: 1.4 }}>
                Efek suara kontekstual per detik momen (bukan lagu BGM datar satu video penuh ala YouTube Clipper).
              </p>

              {/* Action Toolbar: Auto-Detect & Upload */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  id="btn-auto-detect-cues"
                  onClick={handleAutoDetectCues}
                  style={{
                    padding: '6px 11px',
                    borderRadius: 6,
                    border: '1px solid rgba(245, 158, 11, 0.5)',
                    backgroundColor: 'rgba(245, 158, 11, 0.12)',
                    color: '#fbbf24',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    transition: 'all 0.15s ease',
                  }}
                  title="Otomatis pasang Vine Boom pada kalimat kaget/tanda tanya, dan Crickets pada jeda hening"
                >
                  <Zap size={12} fill="#fbbf24" />
                  <span>⚡ Auto-Detect Cue Momen</span>
                </button>

                <button
                  type="button"
                  onClick={() => soundFileInputRef.current?.click()}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid #3f3f46',
                    backgroundColor: '#18181b',
                    color: '#e4e4e7',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: isUploadingSound ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  {isUploadingSound ? (
                    <>
                      <Loader2 size={12} className="spinner" />
                      <span>Mengunggah...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={12} />
                      <span>+ Upload SFX (.wav / .mp3)</span>
                    </>
                  )}
                </button>
                <input
                  ref={soundFileInputRef}
                  type="file"
                  accept="audio/*,.mp3,.wav"
                  style={{ display: 'none' }}
                  onChange={handleUploadSoundFile}
                />

                {soundboardCues.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSoundboardCues([])}
                    style={{
                      padding: '5px 8px',
                      borderRadius: 4,
                      border: 'none',
                      backgroundColor: 'transparent',
                      color: '#71717a',
                      fontSize: 10,
                      cursor: 'pointer',
                      marginLeft: 'auto',
                    }}
                    title="Kosongkan semua cue SFX"
                  >
                    Reset Cues
                  </button>
                )}
              </div>

              {/* Feedback Alert for Auto-Detect */}
              {autoDetectFeedback && (
                <div
                  style={{
                    fontSize: 10.5,
                    color: '#fbbf24',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: 4,
                    padding: '4px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Sparkles size={11} />
                  <span>{autoDetectFeedback}</span>
                </div>
              )}

              {/* Soundboard Interactive Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))',
                  gap: 6,
                }}
              >
                {soundboardSounds.map((snd) => {
                  const isAuditioning = auditioningSoundId === snd.id;
                  return (
                    <div
                      key={snd.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: isAuditioning ? '1px solid rgba(245, 158, 11, 0.6)' : '1px solid #27272a',
                        backgroundColor: isAuditioning ? 'rgba(245, 158, 11, 0.08)' : '#18181b',
                        boxShadow: isAuditioning ? '0 0 14px rgba(245, 158, 11, 0.2), inset 0 1px 0 rgba(245, 158, 11, 0.2)' : 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 14 }}>{snd.icon}</span>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: isAuditioning ? '#fbbf24' : '#f4f4f5',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: 72,
                            }}
                          >
                            {snd.name}
                          </span>
                        </div>

                        {/* Mini Play / Audition Button with Audio Wave Preview */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {isAuditioning && (
                            <div className="audio-wave-container" title="Audio sedang diputar">
                              <span className="audio-wave-bar" />
                              <span className="audio-wave-bar" />
                              <span className="audio-wave-bar" />
                              <span className="audio-wave-bar" />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleAuditionSound(snd.id)}
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: '50%',
                              backgroundColor: isAuditioning ? '#fbbf24' : '#27272a',
                              color: isAuditioning ? '#000000' : '#f4f4f5',
                              border: isAuditioning ? '1px solid #f59e0b' : '1px solid #3f3f46',
                              boxShadow: isAuditioning ? '0 0 8px rgba(245, 158, 11, 0.8)' : 'none',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              flexShrink: 0,
                              transition: 'all 0.15s ease',
                            }}
                            title={isAuditioning ? 'Hentikan preview suara' : 'Tes dengar suara (Audition)'}
                          >
                            {isAuditioning ? <Pause size={9} strokeWidth={3} /> : <Play size={9} fill="currentColor" style={{ marginLeft: 1 }} />}
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 1 }}>
                        <span style={{ fontSize: 9.5, color: '#71717a', fontFamily: 'var(--font-mono)' }}>{snd.duration}s</span>
                        <button
                          type="button"
                          onClick={() => handleAddCueAtCurrentTime(snd.id)}
                          style={{
                            padding: '2px 6px',
                            borderRadius: 4,
                            border: '1px solid #3f3f46',
                            backgroundColor: '#27272a',
                            color: '#e4e4e7',
                            fontSize: 9.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = '#52525b';
                            e.currentTarget.style.backgroundColor = '#3f3f46';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = '#3f3f46';
                            e.currentTarget.style.backgroundColor = '#27272a';
                          }}
                          title={`Pasang suara '${snd.name}' pada detik saat ini (${formatTime(currentPlayTime)})`}
                        >
                          + Waktu Ini
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Active Soundboard Cues Timeline List */}
              {soundboardCues.length > 0 && (
                <div
                  style={{
                    backgroundColor: '#09090b',
                    border: '1px solid #27272a',
                    borderRadius: 6,
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#a1a1aa' }}>
                      TIMELINE MOMEN SFX TERPASANG ({soundboardCues.length}):
                    </span>
                    <span style={{ fontSize: 9, color: '#71717a' }}>Klik timestamp untuk melompat</span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      maxHeight: 120,
                      overflowY: 'auto',
                    }}
                  >
                    {soundboardCues.map((cue, cIdx) => {
                      const snd = soundboardSounds.find((s) => s.id === cue.sound_id);
                      return (
                        <div
                          key={cue.id || cIdx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '3px 6px',
                            backgroundColor: '#121214',
                            borderRadius: 4,
                            border: '1px solid #27272a',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (videoRef.current) {
                                videoRef.current.currentTime = cue.timestamp;
                                setCurrentPlayTime(cue.timestamp);
                              }
                            }}
                            style={{
                              fontFamily: 'monospace',
                              fontSize: 10,
                              fontWeight: 700,
                              color: '#fbbf24',
                              backgroundColor: 'rgba(245, 158, 11, 0.1)',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              borderRadius: 3,
                              padding: '1px 4px',
                              cursor: 'pointer',
                            }}
                            title="Lompat ke waktu cue ini"
                          >
                            {formatTime(cue.timestamp)}
                          </button>

                          <span style={{ fontSize: 12 }}>{snd?.icon || '🔊'}</span>
                          <span style={{ fontSize: 11, color: '#f4f4f5', fontWeight: 600, flex: 1 }}>
                            {snd?.name || cue.sound_id}
                          </span>

                          {/* Mini Volume Control */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 9, color: '#71717a' }}>Vol:</span>
                            <input
                              type="range"
                              min={20}
                              max={150}
                              step={5}
                              value={Math.round((cue.volume ?? 0.9) * 100)}
                              onChange={(e) => handleCueVolumeChange(cIdx, Number(e.target.value) / 100)}
                              style={{ width: 50, accentColor: '#fbbf24', cursor: 'pointer' }}
                              title={`Volume: ${Math.round((cue.volume ?? 0.9) * 100)}%`}
                            />
                            <span style={{ fontSize: 9, color: '#a1a1aa', minWidth: 26, textAlign: 'right' }}>
                              {Math.round((cue.volume ?? 0.9) * 100)}%
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveCue(cue)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#71717a',
                              cursor: 'pointer',
                              padding: '0 2px',
                            }}
                            title="Hapus cue ini"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Subtitle Inline Editor */}
            <div
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 10,
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                flex: 1,
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
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

                      {/* Subtitle Line SFX Cue Badge / [+ SFX] Trigger */}
                      {(() => {
                        const cueForSeg = soundboardCues.find(
                          (c) =>
                            (c.segment_id && c.segment_id === (seg.id || `seg_${idx}`)) ||
                            Math.abs(c.timestamp - seg.start_time) < 0.35
                        );
                        if (cueForSeg) {
                          const snd = soundboardSounds.find((s) => s.id === cueForSeg.sound_id);
                          return (
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '2px 6px',
                                borderRadius: 4,
                                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                border: '1px solid rgba(245, 158, 11, 0.45)',
                                color: '#fbbf24',
                                fontSize: 10,
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                              }}
                              title={`SFX aktif: ${snd?.name || cueForSeg.sound_id} pada detik ${formatTime(cueForSeg.timestamp)}`}
                            >
                              <span>{snd?.icon || '💥'}</span>
                              <span style={{ maxWidth: 68, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {snd?.name || cueForSeg.sound_id}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveCue(cueForSeg)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#f59e0b',
                                  cursor: 'pointer',
                                  padding: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                }}
                                title="Hapus SFX dari baris ini"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          );
                        }
                        return (
                          <div style={{ position: 'relative' }}>
                            <button
                              type="button"
                              id={`btn-add-sfx-${idx}`}
                              onClick={() =>
                                setOpenSfxDropdownIndex(openSfxDropdownIndex === idx ? null : idx)
                              }
                              style={{
                                padding: '2px 6px',
                                borderRadius: 4,
                                border: '1px solid #3f3f46',
                                backgroundColor: '#18181b',
                                color: '#a1a1aa',
                                fontSize: 10,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 3,
                                whiteSpace: 'nowrap',
                                transition: 'all 0.15s ease',
                              }}
                              title="Pasang SFX soundboard pada baris teks ini"
                            >
                              <Sparkles size={10} color="#fbbf24" />
                              <span>+ SFX</span>
                            </button>

                            {openSfxDropdownIndex === idx && (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: '100%',
                                  left: 0,
                                  marginTop: 4,
                                  zIndex: 60,
                                  backgroundColor: '#09090b',
                                  border: '1px solid #27272a',
                                  borderRadius: 6,
                                  boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
                                  width: 175,
                                  padding: 4,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 2,
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 9.5,
                                    fontWeight: 700,
                                    color: '#71717a',
                                    padding: '3px 6px',
                                  }}
                                >
                                  PILIH REACTION SFX:
                                </div>
                                {soundboardSounds.map((snd) => (
                                  <button
                                    key={snd.id}
                                    type="button"
                                    onClick={() => {
                                      handleAddCueAtSegment(idx, snd.id);
                                      setOpenSfxDropdownIndex(null);
                                    }}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      padding: '4px 6px',
                                      borderRadius: 4,
                                      border: 'none',
                                      backgroundColor: 'transparent',
                                      color: '#f4f4f5',
                                      fontSize: 11,
                                      textAlign: 'left',
                                      cursor: 'pointer',
                                    }}
                                    onMouseEnter={(e) =>
                                      (e.currentTarget.style.backgroundColor = '#18181b')
                                    }
                                    onMouseLeave={(e) =>
                                      (e.currentTarget.style.backgroundColor = 'transparent')
                                    }
                                  >
                                    <span>{snd.icon}</span>
                                    <span
                                      style={{
                                        flex: 1,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                      }}
                                    >
                                      {snd.name}
                                    </span>
                                    <span style={{ fontSize: 9, color: '#71717a' }}>
                                      {snd.duration}s
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}

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
              </>
            )}

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
            {isCompleted && (
              <button
                id="btn-download-kit-footer"
                type="button"
                className="btn btn-secondary"
                style={{
                  fontSize: 12,
                  padding: '6px 14px',
                  height: 34,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  color: '#34d399',
                  fontWeight: 600,
                }}
                onClick={handleDownloadPublishingKit}
                disabled={isDownloadingKit}
                title="Unduh Video MP4 9:16 + Cover Feed JPG + Teks Copywriting TXT dalam 1 arsip .zip"
              >
                {isDownloadingKit ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Archive size={13} />
                )}
                {isDownloadingKit ? 'Mengompresi...' : 'Unduh Paket (.zip)'}
              </button>
            )}
            <button
              id="btn-download-cover-studio"
              type="button"
              className="btn btn-secondary"
              style={{
                fontSize: 12,
                padding: '6px 14px',
                height: 34,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                backgroundColor: '#18181b',
                border: '1px solid #3f3f46',
                color: '#f4f4f5',
              }}
              onClick={handleDownloadCover}
              disabled={isGeneratingCover || isRendering}
              title="Download cover/thumbnail feed 1080x1920 JPG dengan teks hook tajam"
            >
              {isGeneratingCover ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Download size={13} />
              )}
              {isGeneratingCover ? 'Membuat Cover...' : 'Download Cover JPG'}
            </button>

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

      {/* Floating Clipboard Copy Notification Toast */}
      {toastMessage && (
        <div className="clipboard-toast-pill">
          <CheckCircle2 size={14} color="#10b981" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
