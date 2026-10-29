/**
 * features/ai/AiStudioView.tsx — AI Creative Studio & Publishing Suite Workspace.
 *
 * Clean Zinc Workstation UI (#09090b, border #27272a).
 * Houses:
 * 1. AI Creative Studio (Social Copywriter for TikTok, Shorts, Reels with 1-click copy)
 * 2. Threads Writer (Viral multi-post breakdown thread generator)
 * 3. Raw Ideas to Content (Angle generator & hook expansion)
 * 4. Content Repurposing (Carousel slides, LinkedIn post, Newsletter format)
 * 5. Content Calendar (Optimal post timing & weekly queue)
 * 6. Ideas & Copy Library (Historical archive of generated copies from all clips)
 */
import type React from 'react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  MessageSquareShare,
  Lightbulb,
  Repeat,
  Calendar as CalendarIcon,
  Bookmark,
  Copy,
  Check,
  RotateCcw,
  Sliders,
  Loader2,
  Hash,
  MessageCircle,
  Film,
} from 'lucide-react';
import type {
  ClipCandidate,
  SocialCopyItem,
  SocialCopyPlatform,
} from '../../types/clip';
import {
  generateClipSocialCopy,
  getClipSocialCopy,
  fetchAllClips,
} from '../../services/clipsApi';

interface AiStudioViewProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  clips: ClipCandidate[];
  activeClip: ClipCandidate | null;
  onSelectClip: (clip: ClipCandidate) => void;
  onOpenEditor?: (clip: ClipCandidate) => void;
  onNavigateToFinder?: () => void;
}

export const AiStudioView: React.FC<AiStudioViewProps> = ({
  activeTab,
  onTabChange,
  clips,
  activeClip,
  onSelectClip,
  onOpenEditor,
  onNavigateToFinder,
}) => {
  // Copy state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Social Copy State
  const [platform, setPlatform] = useState<SocialCopyPlatform>('tiktok');
  const [customTopic, setCustomTopic] = useState('');
  const [copies, setCopies] = useState<Record<string, SocialCopyItem>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingCopies, setIsLoadingCopies] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Library State
  const [allClipsWithCopies, setAllClipsWithCopies] = useState<ClipCandidate[]>([]);
  const [librarySearch, setLibrarySearch] = useState('');

  // ── Load copies for active clip ──────────────────────────────────────────
  const loadActiveClipCopies = useCallback(async () => {
    if (!activeClip) return;
    setIsLoadingCopies(true);
    setError(null);
    try {
      const res = await getClipSocialCopy(activeClip.id);
      if (res && res.copies) {
        setCopies(res.copies);
      }
    } catch {
      // Fallback: check if activeClip.social_copy_json exists locally
      if (activeClip.social_copy_json) {
        try {
          const parsed = JSON.parse(activeClip.social_copy_json);
          setCopies(parsed);
        } catch {
          // ignore
        }
      }
    } finally {
      setIsLoadingCopies(false);
    }
  }, [activeClip]);

  useEffect(() => {
    loadActiveClipCopies();
  }, [loadActiveClipCopies]);

  // ── Load all clips with copy history for Library ─────────────────────────
  const loadLibraryData = useCallback(async () => {
    try {
      const all = await fetchAllClips();
      setAllClipsWithCopies(all);
    } catch {
      setAllClipsWithCopies(clips);
    }
  }, [clips]);

  useEffect(() => {
    if (activeTab === 'ideas-library') {
      loadLibraryData();
    }
  }, [activeTab, loadLibraryData]);

  // ── Copy to clipboard helper ─────────────────────────────────────────────
  const handleCopyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // ── Generate Social Copy AI ──────────────────────────────────────────────
  const handleGenerateCopy = async () => {
    if (!activeClip) return;
    setIsGenerating(true);
    setError(null);
    try {
      const res = await generateClipSocialCopy(
        activeClip.id,
        'all',
        customTopic.trim() || undefined
      );
      if (res && res.copies) {
        setCopies(res.copies);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat copy media sosial.';
      setError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const activeCopyItem = copies[platform];

  // ── Compute historical items for Ideas Library ───────────────────────────
  const historicalItems = useMemo(() => {
    const list: Array<{
      clipId: string;
      clipTitle: string;
      platform: string;
      copy: SocialCopyItem;
      createdAt: string;
    }> = [];

    const sourceClips = allClipsWithCopies.length > 0 ? allClipsWithCopies : clips;

    sourceClips.forEach((c) => {
      if (c.social_copy_json) {
        try {
          const parsed = JSON.parse(c.social_copy_json);
          Object.keys(parsed).forEach((pKey) => {
            list.push({
              clipId: c.id,
              clipTitle: c.title,
              platform: pKey,
              copy: parsed[pKey],
              createdAt: c.created_at,
            });
          });
        } catch {
          // ignore
        }
      }
    });

    if (!librarySearch.trim()) return list;
    const q = librarySearch.toLowerCase();
    return list.filter(
      (item) =>
        item.clipTitle.toLowerCase().includes(q) ||
        item.copy.title?.toLowerCase().includes(q) ||
        item.copy.caption?.toLowerCase().includes(q) ||
        item.copy.hook?.toLowerCase().includes(q) ||
        item.platform.toLowerCase().includes(q)
    );
  }, [allClipsWithCopies, clips, librarySearch]);

  const tabs = [
    { id: 'ai-studio', label: 'AI Creative Studio', icon: Sparkles },
    { id: 'threads-writer', label: 'Threads Writer', icon: MessageSquareShare },
    { id: 'raw-ideas', label: 'Raw Ideas to Content', icon: Lightbulb },
    { id: 'repurposing', label: 'Content Repurposing', icon: Repeat },
    { id: 'calendar', label: 'Content Calendar', icon: CalendarIcon },
    { id: 'ideas-library', label: 'Ideas & Copy Library', icon: Bookmark },
  ];

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
            <Sparkles size={20} color="#ec4899" />
            AI Creative Studio &amp; Publishing Suite
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Otomatisasi pembuatan copy media sosial viral, ekspansi ide, dan strategi distribusi multi-platform.
          </p>
        </div>

        {/* Active Clip Selector */}
        {clips.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Klip Aktif:</span>
            <select
              value={activeClip?.id || ''}
              onChange={(e) => {
                const found = clips.find((c) => c.id === e.target.value);
                if (found) onSelectClip(found);
              }}
              style={{
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                fontSize: 12,
                color: 'var(--text-primary)',
                maxWidth: 260,
                outline: 'none',
              }}
            >
              {clips.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>

            {activeClip && onOpenEditor && (
              <button
                onClick={() => onOpenEditor(activeClip)}
                className="btn btn-secondary btn-sm"
                title="Buka klip di Studio Editor"
              >
                <Sliders size={12} />
                Edit Studio
              </button>
            )}
          </div>
        )}
      </div>

      {/* Workspace Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: 2,
          marginBottom: 24,
          overflowX: 'auto',
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`btn btn-sm ${isActive ? 'btn-secondary' : 'btn-ghost'}`}
              style={{
                borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                borderBottom: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
                padding: '8px 14px',
                fontSize: 12,
                gap: 8,
                whiteSpace: 'nowrap',
              }}
            >
              <Icon size={14} color={isActive ? 'var(--accent-primary)' : 'var(--text-muted)'} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* No Clips Fallback Banner */}
      {clips.length === 0 && activeTab !== 'ideas-library' && (
        <div
          style={{
            textAlign: 'center',
            padding: '48px 24px',
            background: 'var(--bg-surface)',
            border: '1px dashed var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            maxWidth: 600,
            margin: '20px auto',
          }}
        >
          <Film size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px auto' }} />
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Belum Ada Klip yang Dipilih
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            Pilih atau buat klip terlebih dahulu melalui Clip Finder agar AI dapat menganalisis transkrip dan membuat copywriting otomatis.
          </p>
          {onNavigateToFinder && (
            <button onClick={onNavigateToFinder} className="btn btn-primary">
              <Sparkles size={14} />
              Pergi ke Clip Finder
            </button>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          TAB 1: AI CREATIVE STUDIO (Social Copywriter)
         ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'ai-studio' && clips.length > 0 && (
        <div className="dashboard-grid">
          {/* Left Column: Generation Controls */}
          <div className="col-4">
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card-header" style={{ marginBottom: 0 }}>
                <h3 className="card-title" style={{ fontSize: 14 }}>
                  <Sparkles size={14} color="#ec4899" />
                  Konfigurasi Copywriting
                </h3>
              </div>

              {/* Platform Selector Buttons */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Pilih Platform Target
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  {(['tiktok', 'shorts', 'reels'] as SocialCopyPlatform[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPlatform(p)}
                      className={`btn btn-sm ${platform === p ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ fontSize: 11, textTransform: 'capitalize', justifyContent: 'center' }}
                    >
                      {p === 'shorts' ? 'YT Shorts' : p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Topic Input */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Topik / Angle Khusus (Opsional)
                </label>
                <input
                  type="text"
                  placeholder="Misal: 'Tips finansial Gen-Z'..."
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: 12,
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerateCopy}
                disabled={isGenerating || !activeClip}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', gap: 8 }}
              >
                {isGenerating ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                {isGenerating ? 'Menulis Copy AI...' : 'Generate Copywriting AI'}
              </button>

              {/* Error note */}
              {error && (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--status-err)',
                    background: 'var(--status-err-bg)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  {error}
                </div>
              )}

              {/* Clip Insight Info */}
              {activeClip && (
                <div
                  style={{
                    padding: 12,
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 11,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ color: 'var(--text-muted)' }}>Klip Terpilih:</div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{activeClip.title}</div>
                  <div style={{ color: 'var(--text-secondary)' }}>Hook: &ldquo;{activeClip.hook}&rdquo;</div>
                  <div style={{ color: 'var(--status-warn)' }}>Virality: {activeClip.virality_score}/100</div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Copywriting Output Preview */}
          <div className="col-8">
            <div className="card">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingBottom: 12,
                  marginBottom: 16,
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: 'var(--accent-primary)',
                      background: 'rgba(236, 72, 153, 0.12)',
                      padding: '2px 8px',
                      borderRadius: 4,
                    }}
                  >
                    Preview: {platform.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Format siap posting dengan engagement booster
                  </span>
                </div>

                {activeCopyItem && (
                  <button
                    onClick={() =>
                      handleCopyText(activeCopyItem.full_formatted_text, 'full-copy')
                    }
                    className="btn btn-secondary btn-sm"
                    style={{ gap: 6 }}
                  >
                    {copiedKey === 'full-copy' ? (
                      <Check size={13} color="var(--status-ok)" />
                    ) : (
                      <Copy size={13} />
                    )}
                    {copiedKey === 'full-copy' ? 'Tersalin ke Clipboard!' : 'Salin Semua Teks'}
                  </button>
                )}
              </div>

              {isLoadingCopies ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Loader2 size={20} className="spin" style={{ margin: '0 auto 8px auto' }} />
                  Memuat data copywriting klip...
                </div>
              ) : activeCopyItem ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Title / Headline Box */}
                  <div
                    style={{
                      background: 'var(--bg-app)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                        JUDUL POSTINGAN / VIDEO
                      </span>
                      <button
                        onClick={() => handleCopyText(activeCopyItem.title, 'title')}
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '2px 6px', fontSize: 11 }}
                      >
                        {copiedKey === 'title' ? <Check size={12} color="var(--status-ok)" /> : <Copy size={12} />}
                      </button>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {activeCopyItem.title}
                    </div>
                  </div>

                  {/* Hook Line Box */}
                  <div
                    style={{
                      background: 'var(--bg-app)',
                      borderLeft: '3px solid #818cf8',
                      borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                        HOOK 3 DETIK PERTAMA
                      </span>
                      <button
                        onClick={() => handleCopyText(activeCopyItem.hook, 'hook')}
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '2px 6px', fontSize: 11 }}
                      >
                        {copiedKey === 'hook' ? <Check size={12} color="var(--status-ok)" /> : <Copy size={12} />}
                      </button>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', fontStyle: 'italic' }}>
                      &ldquo;{activeCopyItem.hook}&rdquo;
                    </div>
                  </div>

                  {/* Caption & Body */}
                  <div
                    style={{
                      background: 'var(--bg-app)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                        CAPTION DESKRIPSI LENGKAP
                      </span>
                      <button
                        onClick={() => handleCopyText(activeCopyItem.caption, 'caption')}
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '2px 6px', fontSize: 11 }}
                      >
                        {copiedKey === 'caption' ? <Check size={12} color="var(--status-ok)" /> : <Copy size={12} />}
                      </button>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--text-secondary)',
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.6,
                      }}
                    >
                      {activeCopyItem.caption}
                    </div>
                  </div>

                  {/* Hashtags & Comment Trigger CTA */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {/* Hashtags */}
                    <div
                      style={{
                        background: 'var(--bg-app)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 6,
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Hash size={12} />
                          HASHTAG TREN
                        </span>
                        <button
                          onClick={() =>
                            handleCopyText(activeCopyItem.hashtags.join(' '), 'hashtags')
                          }
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '2px 6px', fontSize: 11 }}
                        >
                          {copiedKey === 'hashtags' ? <Check size={12} color="var(--status-ok)" /> : <Copy size={12} />}
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {activeCopyItem.hashtags.map((tag, idx) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: 11,
                              color: '#38bdf8',
                              background: 'rgba(56, 189, 248, 0.1)',
                              padding: '2px 6px',
                              borderRadius: 3,
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Comment CTA */}
                    <div
                      style={{
                        background: 'var(--bg-app)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 6,
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <MessageCircle size={12} />
                          PEMICU KOMENTAR (CTA)
                        </span>
                        <button
                          onClick={() => handleCopyText(activeCopyItem.cta, 'cta')}
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '2px 6px', fontSize: 11 }}
                        >
                          {copiedKey === 'cta' ? <Check size={12} color="var(--status-ok)" /> : <Copy size={12} />}
                        </button>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
                        {activeCopyItem.cta}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '40px 16px',
                    color: 'var(--text-muted)',
                  }}
                >
                  <Sparkles size={24} style={{ margin: '0 auto 10px auto' }} />
                  <p style={{ fontSize: 13, marginBottom: 12 }}>
                    Copywriting untuk platform {platform.toUpperCase()} belum digenerate.
                  </p>
                  <button onClick={handleGenerateCopy} className="btn btn-primary btn-sm">
                    Generate Sekarang (AI)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          TAB 2: THREADS WRITER
         ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'threads-writer' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                <MessageSquareShare size={15} color="#818cf8" />
                Twitter &amp; Threads Viral Post Breakdown
              </h3>
              <p className="card-description">
                Ubah inti pesan klip ini menjadi utas (thread) edukatif yang dirancang untuk retensi membaca tinggi dan repost.
              </p>
            </div>
            {activeClip && (
              <button
                onClick={() =>
                  handleCopyText(
                    `🧵 UTAS: ${activeClip.title}\n\n1/ ${activeClip.hook}\n\n2/ Kebanyakan orang gagal memahami ini: ${activeClip.rationale || 'Fokus pada strategi inti yang konsisten.'}\n\n3/ Takeaway penting: Selalu uji konten dengan hook kuat dalam 3 detik pertama.\n\n4/ Simpan dan repost utas ini jika bermanfaat! 🚀`,
                    'threads-full'
                  )
                }
                className="btn btn-secondary btn-sm"
              >
                {copiedKey === 'threads-full' ? <Check size={13} color="var(--status-ok)" /> : <Copy size={13} />}
                Salin Utas Lengkap
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              {
                num: '1/4',
                label: 'Pembuka (Viral Hook Post)',
                content: activeClip ? activeClip.hook : 'Gunakan hook memikat di tweet pertama.',
              },
              {
                num: '2/4',
                label: 'Masalah / Kesalahan Umum',
                content: activeClip
                  ? `Kenapa banyak orang salah mengira tentang ${activeClip.category || 'topik ini'}? Karena mereka melupakan dasar paling fundamental.`
                  : 'Jabarkan kesalahan umum audiens.',
              },
              {
                num: '3/4',
                label: 'Solusi & Insight Utama',
                content: activeClip?.rationale || 'Jelaskan mengapa insight dari klip ini penting dan actionable.',
              },
              {
                num: '4/4',
                label: 'Call to Action (CTA)',
                content: 'Suka insight praktis seperti ini? Repost utas ini dan follow untuk pembahasan video lengkap berikutnya! 💡',
              },
            ].map((post, idx) => (
              <div
                key={idx}
                style={{
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '14px 16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#818cf8' }}>
                    POST #{post.num} — {post.label}
                  </span>
                  <button
                    onClick={() => handleCopyText(post.content, `thread-${idx}`)}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                  >
                    {copiedKey === `thread-${idx}` ? <Check size={12} color="var(--status-ok)" /> : <Copy size={12} />}
                  </button>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {post.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          TAB 3: RAW IDEAS TO CONTENT
         ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'raw-ideas' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                <Lightbulb size={15} color="#f59e0b" />
                Ekspansi Ide &amp; Angle Kreatif
              </h3>
              <p className="card-description">
                Eksplorasi sudut pandang unik dari topik video ini untuk membuat konten sekuel atau variasi hook berikutnya.
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              {
                title: 'The Contrarian Take',
                desc: 'Bongkar mitos populer yang bertentangan dengan apa yang dibahas di video ini.',
                example: `Jangan percaya kalau ${activeClip?.category || 'topik ini'} itu rumit, yang benar adalah...`,
              },
              {
                title: 'The Beginner Mistake',
                desc: 'Fokus pada kesalahan paling umum pemula yang menghabiskan banyak waktu sia-sia.',
                example: `3 hal yang saya harap saya tahu lebih awal sebelum memulai ${activeClip?.title || 'hal ini'}...`,
              },
              {
                title: 'Behind the Scenes Story',
                desc: 'Bagikan narasi di balik layar atau pengalaman personal terkait pesan klip.',
                example: `Waktu pertama kali coba trik ini, saya hampir menyerah karena...`,
              },
              {
                title: 'Step-by-Step Action Plan',
                desc: 'Rangkum konsep menjadi 3 langkah konkret yang bisa langsung dipraktekkan hari ini.',
                example: `Lakukan 3 langkah ini hari ini untuk hasil maksimal: 1..., 2..., 3...`,
              },
            ].map((angle, idx) => (
              <div
                key={idx}
                style={{
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {angle.title}
                  </span>
                  <button
                    onClick={() => handleCopyText(angle.example, `angle-${idx}`)}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                  >
                    {copiedKey === `angle-${idx}` ? <Check size={12} color="var(--status-ok)" /> : <Copy size={12} />}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{angle.desc}</p>
                <div
                  style={{
                    background: 'var(--bg-surface)',
                    padding: '8px 10px',
                    borderRadius: 4,
                    fontSize: 12,
                    fontStyle: 'italic',
                    color: 'var(--text-secondary)',
                    marginTop: 4,
                  }}
                >
                  &ldquo;{angle.example}&rdquo;
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          TAB 4: CONTENT REPURPOSING
         ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'repurposing' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                <Repeat size={15} color="#06b6d4" />
                Format Repurposing Multi-Channel
              </h3>
              <p className="card-description">
                Manfaatkan 1 video klip menjadi berbagai aset media: Slide Carousel Instagram, Postingan LinkedIn, &amp; Email Newsletter.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Carousel Outline */}
            <div
              style={{
                background: 'var(--bg-app)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#06b6d4' }}>
                  📊 Instagram Carousel Blueprint (5 Slide)
                </span>
                <button
                  onClick={() =>
                    handleCopyText(
                      `Slide 1: ${activeClip?.hook || 'Cover Headline'}\nSlide 2: Masalah Utama\nSlide 3: Solusi Kunci\nSlide 4: Cara Praktek Cepat\nSlide 5: Save & Share!`,
                      'carousel'
                    )
                  }
                  className="btn btn-ghost btn-sm"
                >
                  {copiedKey === 'carousel' ? <Check size={12} color="var(--status-ok)" /> : <Copy size={12} />}
                  Salin Outline
                </button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <div>• <strong>Slide 1 (Cover):</strong> {activeClip?.hook || 'Headline memikat'}</div>
                <div>• <strong>Slide 2 (Context):</strong> Latar belakang mengapa masalah ini krusial dibahas.</div>
                <div>• <strong>Slide 3 (Core Insight):</strong> {activeClip?.title || 'Solusi utama'}</div>
                <div>• <strong>Slide 4 (Actionable Tips):</strong> Ringkasan 3 poin implementasi praktis.</div>
                <div>• <strong>Slide 5 (Outro):</strong> CTA Simpan postingan ini untuk dibaca lagi saat santai.</div>
              </div>
            </div>

            {/* LinkedIn Post Format */}
            <div
              style={{
                background: 'var(--bg-app)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0a66c2' }}>
                  💼 LinkedIn Professional Post
                </span>
                <button
                  onClick={() =>
                    handleCopyText(
                      `Pelajaran berharga dari pembahasan video terbaru:\n\n${activeClip?.hook || ''}\n\nDi industri kita, eksekusi cepat seringkali lebih menentukan daripada rencana yang tertunda.\n\nBagaimana pendapat rekan profesional sekalian?`,
                      'linkedin'
                    )
                  }
                  className="btn btn-ghost btn-sm"
                >
                  {copiedKey === 'linkedin' ? <Check size={12} color="var(--status-ok)" /> : <Copy size={12} />}
                  Salin LinkedIn Post
                </button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {`Pelajaran berharga dari pembahasan video terbaru:\n\n"${activeClip?.hook || ''}"\n\nDi industri modern, adaptasi terhadap tren dan konsistensi publikasi adalah pembeda utama antara pembuat konten biasa dan market leader.\n\nBagaimana pendekatan rekan profesional sekalian? Mari berdiskusi di kolom komentar.`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          TAB 5: CONTENT CALENDAR
         ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'calendar' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                <CalendarIcon size={15} color="#10b981" />
                Jadwal Publikasi &amp; Jam Emas Engagement
              </h3>
              <p className="card-description">
                Rekomendasi slot waktu optimal untuk merilis konten vertikal berdasarkan algoritma media sosial lokal (WIB).
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {[
              {
                platform: 'TikTok',
                color: '#ec4899',
                hours: '12:00 - 13:00 & 18:30 - 21:00 WIB',
                tip: 'Fokus pada retensi 3 detik pertama & sound trending.',
              },
              {
                platform: 'Instagram Reels',
                color: '#e11d48',
                hours: '11:30 - 13:30 & 19:00 - 21:30 WIB',
                tip: 'Visual rapi, tipografi punch pop, & pemicu save/share.',
              },
              {
                platform: 'YouTube Shorts',
                color: '#ef4444',
                hours: '16:00 - 19:00 & 20:00 - 22:00 WIB',
                tip: 'SEO judul kuat dengan keyword yang dicari di search bar.',
              },
            ].map((item, idx) => (
              <div
                key={idx}
                style={{
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: item.color,
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {item.platform}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
                  ⏰ Jam Emas: {item.hours}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  💡 {item.tip}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          TAB 6: IDEAS & COPY LIBRARY
         ────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'ideas-library' && (
        <div className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 16,
              paddingBottom: 12,
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <h3 className="card-title">
                <Bookmark size={15} color="#818cf8" />
                Riwayat Copywriting &amp; Koleksi Ide
              </h3>
              <p className="card-description">
                Koleksi seluruh naskah postingan, hook, dan caption yang pernah digenerate dari klip-klip sebelumnya.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="text"
                placeholder="Cari riwayat copy..."
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  width: 220,
                  outline: 'none',
                }}
              />
              <button onClick={loadLibraryData} className="btn btn-secondary btn-sm">
                <RotateCcw size={12} />
                Refresh
              </button>
            </div>
          </div>

          {historicalItems.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 16px',
                color: 'var(--text-muted)',
              }}
            >
              <Bookmark size={28} style={{ margin: '0 auto 10px auto' }} />
              <p style={{ fontSize: 13, marginBottom: 8 }}>
                Belum ada naskah copy media sosial yang tersimpan.
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Buka tab &ldquo;AI Creative Studio&rdquo; pada salah satu klip dan klik &ldquo;Generate Copywriting AI&rdquo; untuk mulai mengumpulkan riwayat.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {historicalItems.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {/* Top info */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          color: '#ec4899',
                          background: 'rgba(236, 72, 153, 0.1)',
                          padding: '2px 6px',
                          borderRadius: 3,
                        }}
                      >
                        {item.platform}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {item.clipTitle}
                      </span>
                    </div>

                    <button
                      onClick={() =>
                        handleCopyText(item.copy.full_formatted_text, `hist-${idx}`)
                      }
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: 11 }}
                    >
                      {copiedKey === `hist-${idx}` ? (
                        <Check size={12} color="var(--status-ok)" />
                      ) : (
                        <Copy size={12} />
                      )}
                      {copiedKey === `hist-${idx}` ? 'Tersalin!' : '1-Klik Salin'}
                    </button>
                  </div>

                  {/* Hook */}
                  {item.copy.hook && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      Hook: &ldquo;{item.copy.hook}&rdquo;
                    </div>
                  )}

                  {/* Caption preview */}
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      lineHeight: 1.5,
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {item.copy.caption}
                  </div>

                  {/* Hashtags */}
                  {item.copy.hashtags && item.copy.hashtags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {item.copy.hashtags.map((h, hIdx) => (
                        <span key={hIdx} style={{ fontSize: 10, color: '#38bdf8' }}>
                          {h}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
