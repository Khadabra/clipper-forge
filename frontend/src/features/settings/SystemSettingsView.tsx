/**
 * features/settings/SystemSettingsView.tsx — System, AI & Storage Workstation Settings.
 *
 * Clean Zinc Workstation UI (#09090b, border #27272a).
 * Manages Gemini AI model selection, API key status, local storage disk usage,
 * and launches the Token & Quota Usage Monitor modal.
 */
import type React from 'react';
import { useState } from 'react';
import {
  Settings,
  Zap,
  Terminal,
  HardDrive,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  Database,
} from 'lucide-react';
import type { SystemCheckResponse } from '../../types/system';
import { TokenMonitorModal } from '../../components/layout/TokenMonitorModal';

interface SystemSettingsViewProps {
  systemData: SystemCheckResponse | null;
  loading: boolean;
  onRefresh: () => void;
  backendConnected: boolean;
}

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({
  systemData,
  loading,
  onRefresh,
  backendConnected,
}) => {
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [autoFallback, setAutoFallback] = useState(true);

  const ffmpeg = systemData?.ffmpeg;
  const disk = systemData?.disk_space;
  const usedPercent = disk ? Math.round((disk.used_gb / disk.total_gb) * 100) : 0;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
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
              color: 'var(--text-primary)',
              letterSpacing: '-0.3px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 4,
            }}
          >
            <Settings size={20} color="var(--text-muted)" />
            System &amp; AI Engine Settings
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Konfigurasi model Gemini AI, kuota token, mesin transkripsi lokal, dan status disk storage workstation.
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="btn btn-secondary btn-sm"
        >
          <RotateCcw size={12} className={loading ? 'spin' : ''} />
          Refresh Status
        </button>
      </div>

      <div className="dashboard-grid">
        {/* Left: AI & Model Settings */}
        <div className="col-6">
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <Sparkles size={15} color="var(--accent-primary)" />
                  Gemini AI Engine
                </h3>
                <p className="card-description">
                  Model AI untuk kurasi hook viral, analisis SEO judul, dan copywriting sosial.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Active Model Selector */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Active Model Architecture
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    {
                      id: 'gemini-3.8-flash',
                      title: 'Gemini 3.8 Flash (Default / Cepat)',
                      desc: 'Latensi ultra-rendah untuk pemindaian momen viral dan pembuatan copy real-time.',
                    },
                    {
                      id: 'gemini-2.5-flash',
                      title: 'Gemini 2.5 Flash (Analisis Mendalam)',
                      desc: 'Penalaran semantik komprehensif untuk naskah transkrip panjang.',
                    },
                  ].map((m) => (
                    <div
                      key={m.id}
                      onClick={() => setSelectedModel(m.id)}
                      style={{
                        padding: '12px 14px',
                        background:
                          selectedModel === m.id
                            ? 'var(--bg-surface-elevated)'
                            : 'var(--bg-app)',
                        border: `1px solid ${
                          selectedModel === m.id
                            ? 'var(--accent-primary)'
                            : 'var(--border-subtle)'
                        }`,
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>{m.title}</strong>
                        {selectedModel === m.id && (
                          <CheckCircle2 size={13} color="var(--accent-primary)" />
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Local Heuristic Fallback Toggle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px',
                  background: 'var(--bg-app)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                    Fallback Lokal Offline Otomatis
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Jika kuota Gemini habis atau offline, gunakan algoritma heuristik lokal tanpa error.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={autoFallback}
                  onChange={(e) => setAutoFallback(e.target.checked)}
                  style={{ cursor: 'pointer', width: 16, height: 16 }}
                />
              </div>

              {/* Token Monitor Action */}
              <div
                style={{
                  padding: '14px',
                  background: 'rgba(225, 29, 72, 0.08)',
                  border: '1px solid rgba(225, 29, 72, 0.25)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Zap size={14} />
                    Gemini Token Usage &amp; Quota Monitor
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    Pantau konsumsi token per fitur, estimasi biaya, dan sisa batas harian.
                  </div>
                </div>
                <button
                  onClick={() => setIsTokenModalOpen(true)}
                  className="btn btn-primary btn-sm"
                  style={{ fontSize: 11 }}
                >
                  Buka Monitor
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Local Hardware & Storage Diagnostics */}
        <div className="col-6">
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <Terminal size={15} color="var(--status-ok)" />
                  Mesin Lokal &amp; Storage
                </h3>
                <p className="card-description">
                  Dependensi sistem lokal di komputer host workstation.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Backend API status */}
              <div className="metric-row">
                <div className="metric-label">
                  <Database size={13} color={backendConnected ? 'var(--status-ok)' : 'var(--status-err)'} />
                  <span>Backend FastAPI Service</span>
                </div>
                <div className="metric-value">
                  <span style={{ color: backendConnected ? 'var(--status-ok)' : 'var(--status-err)' }}>
                    {backendConnected ? 'Online (Port 8000)' : 'Disconnected'}
                  </span>
                </div>
              </div>

              {/* FFmpeg status */}
              <div className="metric-row">
                <div className="metric-label">
                  <Terminal size={13} color={ffmpeg?.available ? 'var(--status-ok)' : 'var(--status-warn)'} />
                  <span>FFmpeg Local Transcoder</span>
                </div>
                <div className="metric-value">
                  <span style={{ color: ffmpeg?.available ? 'var(--status-ok)' : 'var(--status-warn)' }}>
                    {ffmpeg?.available ? 'Ready (Local)' : 'Not Found'}
                  </span>
                </div>
              </div>

              {/* Disk Space Meter */}
              <div style={{ padding: '12px', background: 'var(--bg-app)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
                    <HardDrive size={13} color="var(--text-muted)" />
                    <span>Kapasitas Penyimpanan Storage</span>
                  </div>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                    {disk ? `${disk.free_gb.toFixed(1)} GB Free (${disk.total_gb.toFixed(0)} GB Total)` : '—'}
                  </span>
                </div>
                <div className="upload-progress-track">
                  <div
                    className="upload-progress-fill"
                    style={{
                      width: `${usedPercent}%`,
                      background: usedPercent > 85 ? 'var(--status-err)' : 'var(--accent-primary)',
                    }}
                  />
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                  Folder lokal: <code>backend/storage/</code> (Proyek, Ekspor MP4, Soundboard SFX)
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Token Monitor Modal */}
      <TokenMonitorModal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
      />
    </div>
  );
};
