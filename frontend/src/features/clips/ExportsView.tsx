/**
 * features/clips/ExportsView.tsx — Completed Clips Export & Publishing Gallery.
 *
 * Modern Zinc SaaS Workstation (#09090b, border #27272a, emerald #10b981, amber #f59e0b).
 * Displays rendered 9:16 vertical clips, video modal player, JPG cover previews,
 * grouped action buttons (Putar Video, Unduh MP4, Unduh Cover JPG, Unduh Bundle ZIP),
 * satisfying confetti celebration on ZIP publishing kits, and polished empty states.
 */
import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import {
  Download,
  Film,
  Sparkles,
  Archive,
  Image as ImageIcon,
  RotateCcw,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
  Play,
  X,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import type { ClipCandidate } from '../../types/clip';
import {
  fetchAllClips,
  getRenderedClipStreamUrl,
  getClipCoverUrl,
  downloadRenderedClip,
  generateAndDownloadCover,
  downloadExportKit,
} from '../../services/clipsApi';

interface ExportsViewProps {
  onOpenEditor?: (clip: ClipCandidate) => void;
  onNavigateToFinder?: () => void;
  onNavigateToProjects?: () => void;
}

export const ExportsView: React.FC<ExportsViewProps> = ({
  onOpenEditor,
  onNavigateToFinder,
  onNavigateToProjects,
}) => {
  const [completedClips, setCompletedClips] = useState<ClipCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDownload, setActiveDownload] = useState<{
    clipId: string;
    type: 'mp4' | 'jpg' | 'zip';
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPreviewClip, setSelectedPreviewClip] = useState<ClipCandidate | null>(null);

  const loadExports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAllClips('completed');
      setCompletedClips(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat galeri ekspor klip.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExports();
  }, [loadExports]);

  const handleDownloadMp4 = async (clip: ClipCandidate) => {
    try {
      setActiveDownload({ clipId: clip.id, type: 'mp4' });
      await downloadRenderedClip(clip.id, `${clip.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_9-16.mp4`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Gagal mengunduh video MP4.');
    } finally {
      setActiveDownload(null);
    }
  };

  const handleDownloadCover = async (clip: ClipCandidate) => {
    try {
      setActiveDownload({ clipId: clip.id, type: 'jpg' });
      await generateAndDownloadCover(clip.id, `cover_${clip.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Gagal mengunduh cover thumbnail JPG.');
    } finally {
      setActiveDownload(null);
    }
  };

  const handleDownloadZipKit = async (clip: ClipCandidate) => {
    try {
      setActiveDownload({ clipId: clip.id, type: 'zip' });

      // Efek kepuasan: Confetti halus ala Zinc SaaS saat bundle ZIP mulai diunduh
      try {
        confetti({
          particleCount: 75,
          spread: 65,
          origin: { y: 0.72 },
          colors: ['#10b981', '#34d399', '#f59e0b', '#38bdf8', '#f4f4f5'],
          ticks: 200,
          gravity: 1.1,
          scalar: 0.9,
          disableForReducedMotion: true,
        });
      } catch {
        // Fallback gracefully if canvas context unavailable
      }

      await downloadExportKit(clip.id, `PublishingKit_${clip.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Gagal mengunduh ZIP publishing kit.');
    } finally {
      setActiveDownload(null);
    }
  };

  const filteredClips = completedClips.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      (c.hook && c.hook.toLowerCase().includes(q)) ||
      (c.category && c.category.toLowerCase().includes(q))
    );
  });

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', paddingBottom: 48 }}>
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: '#f4f4f5',
              letterSpacing: '-0.3px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 4,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Download size={17} color="#10b981" />
            </div>
            Galeri Ekspor &amp; Publikasi Klip
          </h1>
          <p style={{ fontSize: 13, color: '#a1a1aa' }}>
            Koleksi video vertikal 9:16 hasil render lokal workstation yang siap dipublikasikan ke TikTok, YouTube Shorts, &amp; Instagram Reels.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={loadExports}
            disabled={loading}
            className="btn btn-secondary btn-sm"
            style={{
              height: 32,
              padding: '0 12px',
              fontSize: 12,
              border: '1px solid #27272a',
              backgroundColor: '#141416',
              color: '#e4e4e7',
            }}
            title="Muat ulang daftar ekspor"
          >
            <RotateCcw size={13} className={loading ? 'spin' : ''} />
            Refresh
          </button>
          {onNavigateToFinder && (
            <button
              onClick={onNavigateToFinder}
              className="btn btn-primary btn-sm"
              style={{
                height: 32,
                padding: '0 14px',
                fontSize: 12,
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: '#ffffff',
                boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)',
              }}
            >
              <Sparkles size={13} />
              Cari Klip Baru
            </button>
          )}
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'rgba(24, 24, 27, 0.65)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid #27272a',
          borderRadius: 10,
          marginBottom: 24,
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <input
            type="text"
            placeholder="Cari klip berdasarkan judul atau hook viral..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              maxWidth: 380,
              padding: '7px 12px',
              fontSize: 12,
              background: '#121214',
              border: '1px solid #27272a',
              borderRadius: 6,
              color: '#f4f4f5',
              outline: 'none',
              transition: 'border-color 0.15s ease',
            }}
            onFocus={(e) => (e.target.style.borderColor = '#52525b')}
            onBlur={(e) => (e.target.style.borderColor = '#27272a')}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11, color: '#a1a1aa' }}
            >
              Reset
            </button>
          )}
        </div>

        <div style={{ fontSize: 12, color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>Total Siap Unduh:</span>
          <span
            style={{
              color: '#10b981',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              padding: '1px 7px',
              borderRadius: 4,
              border: '1px solid rgba(16, 185, 129, 0.25)',
            }}
          >
            {filteredClips.length}
          </span>
          <span>video</span>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div
          style={{
            background: 'rgba(244, 63, 94, 0.08)',
            border: '1px solid rgba(244, 63, 94, 0.25)',
            borderRadius: 8,
            padding: '14px 18px',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            color: '#f43f5e',
            fontSize: 13,
          }}
        >
          <AlertCircle size={16} />
          <span>{error}</span>
          <button
            onClick={loadExports}
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 'auto', fontSize: 11, color: '#f43f5e' }}
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div
          style={{
            padding: '72px 0',
            textAlign: 'center',
            color: '#71717a',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <Loader2 size={26} className="spin" color="#10b981" />
          <span style={{ fontSize: 13, color: '#a1a1aa' }}>Memuat daftar video yang sudah dirender...</span>
        </div>
      ) : filteredClips.length === 0 ? (
        /* Empty State */
        <div
          style={{
            textAlign: 'center',
            padding: '56px 28px',
            background: 'rgba(18, 18, 20, 0.65)',
            border: '1px dashed #27272a',
            borderRadius: 14,
            maxWidth: 580,
            margin: '40px auto',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 14,
              background: '#18181b',
              border: '1px solid #27272a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 18px auto',
              color: '#71717a',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}
          >
            <Film size={26} color="#71717a" />
          </div>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: '#f4f4f5', letterSpacing: '-0.2px' }}>
            Belum Ada Klip yang Dirender
          </h3>
          <p style={{ fontSize: 13, color: '#a1a1aa', lineHeight: 1.6, marginBottom: 24, maxWidth: 440, margin: '0 auto 24px auto' }}>
            Klip yang telah selesai dirender menjadi video vertikal 9:16 (lengkap dengan subtitle hormonal/punch, zoom dinamis, dan soundboard SFX) akan muncul di sini.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
            {onNavigateToFinder && (
              <button
                onClick={onNavigateToFinder}
                className="btn btn-primary"
                style={{
                  fontSize: 12.5,
                  padding: '8px 18px',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  color: '#ffffff',
                  boxShadow: '0 2px 10px rgba(16, 185, 129, 0.25)',
                }}
              >
                <Sparkles size={14} />
                Mulai Buat Klip
              </button>
            )}
            {onNavigateToProjects && (
              <button
                onClick={onNavigateToProjects}
                className="btn btn-secondary"
                style={{
                  fontSize: 12.5,
                  padding: '8px 16px',
                  border: '1px solid #27272a',
                  backgroundColor: '#18181b',
                  color: '#e4e4e7',
                }}
              >
                <Layers size={14} />
                Kelola Proyek Video
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Grid of Export Cards */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
            gap: 22,
          }}
        >
          {filteredClips.map((clip) => {
            const duration = Math.max(1, Math.round(clip.end_time - clip.start_time));
            const streamUrl = getRenderedClipStreamUrl(clip.project_id, clip.id);
            const coverUrl = getClipCoverUrl(clip.id);

            const isDownloadingMp4 =
              activeDownload?.clipId === clip.id && activeDownload?.type === 'mp4';
            const isDownloadingJpg =
              activeDownload?.clipId === clip.id && activeDownload?.type === 'jpg';
            const isDownloadingZip =
              activeDownload?.clipId === clip.id && activeDownload?.type === 'zip';

            return (
              <div
                key={clip.id}
                className="card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  background: '#121214',
                  border: '1px solid #27272a',
                  borderRadius: 12,
                  transition: 'border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#3f3f46';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#27272a';
                  e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
                }}
              >
                {/* Media Preview Box (Precision 9:16 Frame Container) */}
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: 290,
                    background: '#09090b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    borderBottom: '1px solid #27272a',
                  }}
                >
                  <video
                    src={streamUrl}
                    poster={coverUrl}
                    controls
                    preload="metadata"
                    style={{
                      maxHeight: '100%',
                      maxWidth: '100%',
                      objectFit: 'contain',
                      borderRadius: 4,
                    }}
                  />

                  {/* Top Left Badges: Selesai (Emerald) & Virality (Amber) */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 10,
                      left: 10,
                      display: 'flex',
                      gap: 6,
                      pointerEvents: 'none',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '3px 9px',
                        borderRadius: 9999,
                        background: 'rgba(16, 185, 129, 0.92)',
                        color: '#ffffff',
                        backdropFilter: 'blur(6px)',
                        WebkitBackdropFilter: 'blur(6px)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        boxShadow: '0 2px 8px rgba(16, 185, 129, 0.4)',
                        letterSpacing: '0.3px',
                      }}
                    >
                      <CheckCircle2 size={11} strokeWidth={2.6} />
                      Selesai
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 9999,
                        background: 'rgba(9, 9, 11, 0.85)',
                        color: '#fbbf24',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        backdropFilter: 'blur(6px)',
                        WebkitBackdropFilter: 'blur(6px)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                      }}
                    >
                      🔥 {clip.virality_score}/100
                    </span>
                  </div>

                  {/* Bottom Right Badges: Duration & Aspect Ratio */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 10,
                      right: 10,
                      background: 'rgba(9, 9, 11, 0.85)',
                      backdropFilter: 'blur(6px)',
                      WebkitBackdropFilter: 'blur(6px)',
                      border: '1px solid #27272a',
                      padding: '3px 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      color: '#f4f4f5',
                      pointerEvents: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span>{duration}s</span>
                    <span style={{ color: '#52525b' }}>•</span>
                    <span style={{ color: '#a1a1aa' }}>9:16</span>
                  </div>
                </div>

                {/* Card Content & Action Controls */}
                <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  {clip.quality_report_json && (() => {
                    try {
                      const q = JSON.parse(clip.quality_report_json);
                      const isPass = q.status === 'pass';
                      const isWarn = q.status === 'warning';
                      return (
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 4,
                            marginBottom: 8,
                            backgroundColor: isPass ? 'rgba(16, 185, 129, 0.08)' : isWarn ? 'rgba(245, 158, 11, 0.08)' : 'rgba(244, 63, 94, 0.08)',
                            border: `1px solid ${isPass ? 'rgba(16, 185, 129, 0.25)' : isWarn ? 'rgba(245, 158, 11, 0.25)' : 'rgba(244, 63, 94, 0.25)'}`,
                            color: isPass ? '#10b981' : isWarn ? '#f59e0b' : '#f43f5e',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            width: 'fit-content',
                          }}
                          title={q.issues && q.issues.length ? q.issues.map((i: any) => i.message).join('\n') : 'Semua pemeriksaan broadcast lulus'}
                        >
                          <span>{isPass ? '✓ Quality Gate: Lulus' : isWarn ? '⚠️ Quality Gate: Warning' : '✕ Quality Gate: Periksa Ulang'}</span>
                          {q.metrics?.duration && (
                            <span style={{ color: '#71717a', fontFamily: 'var(--font-mono)' }}>
                              ({q.metrics.duration}s{q.metrics.audio_mean_volume_db ? ` • ${q.metrics.audio_mean_volume_db}dB` : ''})
                            </span>
                          )}
                        </div>
                      );
                    } catch {
                      return null;
                    }
                  })()}

                  <h3
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: '#f4f4f5',
                      lineHeight: 1.4,
                      marginBottom: 6,
                      letterSpacing: '-0.1px',
                    }}
                  >
                    {clip.title}
                  </h3>

                  {clip.hook && (
                    <div
                      style={{
                        fontSize: 12,
                        color: '#a1a1aa',
                        fontStyle: 'italic',
                        marginBottom: 12,
                        lineHeight: 1.4,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      &ldquo;{clip.hook}&rdquo;
                    </div>
                  )}

                  {/* Metadata tags */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flexWrap: 'wrap',
                      marginBottom: 16,
                      marginTop: 'auto',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 7px',
                        borderRadius: 4,
                        background: '#18181b',
                        border: '1px solid #27272a',
                        color: '#a1a1aa',
                      }}
                    >
                      Sub: {clip.subtitle_style}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 7px',
                        borderRadius: 4,
                        background: '#18181b',
                        border: '1px solid #27272a',
                        color: '#a1a1aa',
                      }}
                    >
                      Crop: {clip.crop_mode}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 7px',
                        borderRadius: 4,
                        background: '#18181b',
                        border: '1px solid #27272a',
                        color: clip.enable_sfx ? '#34d399' : '#71717a',
                      }}
                    >
                      SFX: {clip.enable_sfx ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>

                  {/* Grouped Action Buttons with Refined Workstation Gradients */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Primary Row: Putar Video & Unduh MP4 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <button
                        onClick={() => setSelectedPreviewClip(clip)}
                        className="btn btn-secondary btn-sm"
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          justifyContent: 'center',
                          height: 32,
                          border: '1px solid #27272a',
                          backgroundColor: '#18181b',
                          color: '#f4f4f5',
                          transition: 'all 0.15s ease',
                        }}
                        title="Buka pemutar video theater mode"
                      >
                        <Play size={12} fill="#e4e4e7" color="#e4e4e7" />
                        Putar Video
                      </button>

                      <button
                        onClick={() => handleDownloadMp4(clip)}
                        disabled={isDownloadingMp4}
                        className="btn btn-secondary btn-sm"
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          justifyContent: 'center',
                          height: 32,
                          border: '1px solid rgba(16, 185, 129, 0.35)',
                          backgroundColor: 'rgba(16, 185, 129, 0.08)',
                          color: '#34d399',
                          transition: 'all 0.15s ease',
                        }}
                        title="Unduh file video MP4 9:16 hasil render lokal"
                      >
                        {isDownloadingMp4 ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <Film size={12} color="#10b981" />
                        )}
                        Unduh MP4
                      </button>
                    </div>

                    {/* Secondary Row: Unduh Cover JPG & Unduh Bundle ZIP */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.35fr', gap: 8 }}>
                      <button
                        onClick={() => handleDownloadCover(clip)}
                        disabled={isDownloadingJpg}
                        className="btn btn-secondary btn-sm"
                        style={{
                          fontSize: 11.5,
                          fontWeight: 500,
                          justifyContent: 'center',
                          height: 32,
                          border: '1px solid #27272a',
                          backgroundColor: '#18181b',
                          color: '#a1a1aa',
                          transition: 'all 0.15s ease',
                        }}
                        title="Unduh cover feed thumbnail 1080x1920 JPG"
                      >
                        {isDownloadingJpg ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <ImageIcon size={12} color="#38bdf8" />
                        )}
                        Cover JPG
                      </button>

                      <button
                        onClick={() => handleDownloadZipKit(clip)}
                        disabled={isDownloadingZip}
                        className="btn btn-primary btn-sm"
                        style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          justifyContent: 'center',
                          height: 32,
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                          border: '1px solid rgba(16, 185, 129, 0.4)',
                          color: '#ffffff',
                          boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)',
                          transition: 'all 0.15s ease',
                        }}
                        title="Unduh paket lengkap (.zip) berisi Video MP4 + Cover JPG + Teks Copywriting TXT"
                      >
                        {isDownloadingZip ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <Archive size={12} />
                        )}
                        Unduh Bundle ZIP
                      </button>
                    </div>

                    {/* Editor Shortcut */}
                    {onOpenEditor && (
                      <button
                        onClick={() => onOpenEditor(clip)}
                        className="btn btn-ghost btn-sm"
                        style={{
                          fontSize: 11,
                          justifyContent: 'center',
                          height: 28,
                          color: '#71717a',
                          marginTop: 2,
                        }}
                      >
                        <Sliders size={12} />
                        Buka di Studio Editor
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Theater Video Preview Modal */}
      {selectedPreviewClip && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setSelectedPreviewClip(null)}
        >
          <div
            style={{
              position: 'relative',
              backgroundColor: '#121214',
              border: '1px solid #27272a',
              borderRadius: 14,
              overflow: 'hidden',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.8)',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '92vh',
              maxWidth: 440,
              width: '100%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '1px solid #27272a',
                backgroundColor: '#18181b',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Film size={14} color="#10b981" />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#f4f4f5',
                    maxWidth: 320,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {selectedPreviewClip.title}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPreviewClip(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#a1a1aa',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Video Player 9:16 */}
            <div
              style={{
                backgroundColor: '#000000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 520,
                position: 'relative',
              }}
            >
              <video
                src={getRenderedClipStreamUrl(selectedPreviewClip.project_id, selectedPreviewClip.id)}
                poster={getClipCoverUrl(selectedPreviewClip.id)}
                controls
                autoPlay
                playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
              />
            </div>

            {/* Modal Footer Quick Actions */}
            <div
              style={{
                padding: '12px 16px',
                borderTop: '1px solid #27272a',
                backgroundColor: '#141416',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                Format: 1080x1920 MP4 (9:16)
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => handleDownloadMp4(selectedPreviewClip)}
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                >
                  <Download size={12} /> Unduh MP4
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadZipKit(selectedPreviewClip)}
                  className="btn btn-primary btn-sm"
                  style={{
                    fontSize: 11,
                    padding: '4px 12px',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    color: '#ffffff',
                  }}
                >
                  <Archive size={12} /> Bundle ZIP
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
