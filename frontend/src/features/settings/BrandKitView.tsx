/**
 * features/settings/BrandKitView.tsx — Style Presets & Visual Brand Kit Workstation.
 *
 * Clean Zinc Workstation UI (#09090b, border #27272a).
 * Displays interactive typography presets, color tokens, and safe zone guides.
 */
import type React from 'react';
import { useState } from 'react';
import { Palette, Type, Check, ShieldCheck } from 'lucide-react';

export const BrandKitView: React.FC = () => {
  const [activePreset, setActivePreset] = useState<string>('hormozi');
  const [selectedColor, setSelectedColor] = useState<string>('#e11d48');

  const typographyPresets = [
    {
      id: 'hormozi',
      name: 'Hormozi Punch Pop',
      font: 'Impact, sans-serif',
      color: '#FFE500',
      outline: '3px #000000',
      casing: 'UPPERCASE',
      desc: 'Font Impact tebal berwarna kuning emas dengan outline hitam tebal. Terbukti meningkatkan retensi video shorts hingga 40%.',
    },
    {
      id: 'condensed_clean',
      name: 'Condensed Clean',
      font: 'Bahnschrift, DIN, Arial, sans-serif',
      color: '#FFFFFF',
      outline: '2px #000000',
      casing: 'Clean Title Case',
      desc: 'Font condensed modern minimalis dengan kontras tajam. Sangat cocok untuk konten edukasi, bisnis, dan dokumenter.',
    },
    {
      id: 'boxed_vox',
      name: 'Boxed Vox Editorial',
      font: '"Segoe UI Black", Impact, sans-serif',
      color: '#FFFFFF',
      background: 'rgba(0, 0, 0, 0.75)',
      casing: 'Sentence case',
      desc: 'Teks berlatar box gelap transparan bergaya Vox/Bloomberg. Memastikan keterbacaan 100% pada background video apa pun.',
    },
    {
      id: 'cyber_neon',
      name: 'Cyber Neon Glow',
      font: 'Impact, sans-serif',
      color: '#00F0FF',
      outline: '2px #FF007F',
      casing: 'UPPERCASE',
      desc: 'Warna cyan elektrik dengan pendaran neon hot magenta. Pilihan sempurna untuk gaming, tekno, dan podcast Gen-Z.',
    },
    {
      id: 'word_highlight',
      name: 'Word Karaoke Highlight',
      font: 'Impact, sans-serif',
      color: '#FFE500',
      highlightColor: '#FFE500',
      casing: 'UPPERCASE',
      desc: 'Efek karaoke real-time: kata yang sedang diucapkan menyala kuning cerah sementara kata lain tetap putih.',
    },
  ];

  const brandColors = [
    { name: 'Crimson Rose', hex: '#e11d48' },
    { name: 'Electric Indigo', hex: '#6366f1' },
    { name: 'Emerald Mint', hex: '#10b981' },
    { name: 'Amber Gold', hex: '#f59e0b' },
    { name: 'Cyan Neon', hex: '#06b6d4' },
    { name: 'Hot Pink', hex: '#ec4899' },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
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
          <Palette size={20} color="#f59e0b" />
          Style Presets &amp; Brand Kit
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Kustomisasi identitas visual video: preset tipografi subtitle, palet warna brand, dan panduan batas aman (safe zones) media sosial.
        </p>
      </div>

      <div className="dashboard-grid">
        {/* Left: Typography Showcase */}
        <div className="col-8">
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <Type size={15} color="var(--accent-primary)" />
                  Preset Tipografi Subtitle
                </h3>
                <p className="card-description">
                  Pilih gaya subtitle bawaan yang otomatis diterapkan saat merender klip video vertikal.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {typographyPresets.map((preset) => {
                const isSelected = activePreset === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => setActivePreset(preset.id)}
                    style={{
                      background: isSelected ? 'var(--bg-surface-elevated)' : 'var(--bg-app)',
                      border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '16px',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {preset.name}
                      </span>
                      {isSelected && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: 'var(--accent-primary)',
                            background: 'rgba(225, 29, 72, 0.1)',
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-pill)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Check size={11} /> AKTIF
                        </span>
                      )}
                    </div>

                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.4 }}>
                      {preset.desc}
                    </p>

                    {/* Live typography specimen preview */}
                    <div
                      style={{
                        background: '#09090b',
                        border: '1px solid #27272a',
                        borderRadius: 6,
                        padding: '16px',
                        textAlign: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: preset.font,
                          color: preset.color,
                          fontSize: 22,
                          fontWeight: 900,
                          textTransform: preset.casing.includes('UPPERCASE') ? 'uppercase' : 'none',
                          textShadow:
                            preset.id === 'hormozi'
                              ? '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 4px 8px rgba(0,0,0,0.8)'
                              : preset.id === 'condensed_clean'
                              ? '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000'
                              : preset.id === 'cyber_neon'
                              ? '0 0 10px #00F0FF, 0 0 20px #FF007F, 2px 2px 0 #000'
                              : 'none',
                          backgroundColor: preset.background || 'transparent',
                          padding: preset.background ? '4px 12px' : '0',
                          borderRadius: preset.background ? 4 : 0,
                          letterSpacing: preset.id === 'condensed_clean' ? '-0.5px' : '0.5px',
                        }}
                      >
                        {preset.id === 'word_highlight' ? (
                          <>
                            <span style={{ color: '#ffffff', textShadow: '-2px -2px 0 #000, 2px 2px 0 #000' }}>INI ADALAH </span>
                            <span style={{ color: '#FFE500', textShadow: '-2px -2px 0 #000, 2px 2px 0 #000, 0 0 12px #FFE500' }}>KATA KUNCI </span>
                            <span style={{ color: '#ffffff', textShadow: '-2px -2px 0 #000, 2px 2px 0 #000' }}>VIRAL</span>
                          </>
                        ) : (
                          'INI CONTOH SUBTITLE VIRAL'
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Colors & Safe Zone */}
        <div className="col-4">
          {/* Colors Card */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <h3 className="card-title" style={{ fontSize: 13 }}>
                <Palette size={14} color="#f59e0b" />
                Warna Aksen Brand
              </h3>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {brandColors.map((c) => (
                <div
                  key={c.hex}
                  onClick={() => setSelectedColor(c.hex)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    padding: 8,
                    borderRadius: 6,
                    background: 'var(--bg-app)',
                    border: `1px solid ${selectedColor === c.hex ? c.hex : 'var(--border-subtle)'}`,
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: c.hex,
                      boxShadow: selectedColor === c.hex ? `0 0 10px ${c.hex}` : 'none',
                    }}
                  />
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{c.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Safe Zones Card */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title" style={{ fontSize: 13 }}>
                <ShieldCheck size={14} color="#10b981" />
                Panduan Safe Zones 9:16
              </h3>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ background: 'var(--bg-app)', padding: 10, borderRadius: 4 }}>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 2 }}>
                  Margin Bawah (MarginV 280-320px)
                </strong>
                Mencegah subtitle tertutup oleh username, caption TikTok, dan audio wave icon.
              </div>
              <div style={{ background: 'var(--bg-app)', padding: 10, borderRadius: 4 }}>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 2 }}>
                  Margin Kanan (Safe 110px)
                </strong>
                Menjaga teks hook tidak terpotong oleh tombol Like, Komen, Share, &amp; Profil di Reels / Shorts.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
