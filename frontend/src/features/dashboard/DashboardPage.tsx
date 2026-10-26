import type React from 'react';
import {
  CheckCircle2,
  HardDrive,
  Cpu,
  Terminal,
  FolderPlus,
  ArrowRight,
  ShieldAlert,
  Server,
  Layers,
} from 'lucide-react';
import type { SystemCheckResponse } from '../../types/system';

interface DashboardPageProps {
  systemData: SystemCheckResponse | null;
  loading: boolean;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  systemData,
  loading,
}) => {
  const ffmpeg = systemData?.ffmpeg;
  const ffprobe = systemData?.ffprobe;
  const python = systemData?.python;
  const disk = systemData?.disk_space;

  const usedPercent = disk ? Math.round((disk.used_gb / disk.total_gb) * 100) : 0;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Hero Welcome Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(168, 85, 247, 0.05))',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px 28px',
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backdropFilter: 'blur(8px)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span
              style={{
                background: 'var(--accent-primary)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 'var(--radius-pill)',
                textTransform: 'uppercase',
              }}
            >
              M1 — Foundation
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              Local-first Architecture Verified
            </span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            ClipForge Studio Workstation
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, maxWidth: 650 }}>
            Platform produksi konten dan clipping video cerdas dengan kendali lokal penuh, pemrosesan aman tanpa API berbayar wajib, dan alur kerja terstruktur dari ide hingga distribusi multi-platform.
          </p>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Environment
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            localhost:5173 ↔ :8000
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Left Column: System Diagnostics Card */}
        <div className="col-8">
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">
                  <Server size={17} color="#818cf8" />
                  System Diagnostics & Media Engine
                </h2>
                <p className="card-description">
                  Status verifikasi dependensi backend, pemrosesan video, dan kapasitas penyimpanan lokal.
                </p>
              </div>
              <span
                className={`status-pill ${
                  systemData?.status === 'ready' ? 'ready' : 'warning'
                }`}
              >
                {systemData?.status === 'ready' ? 'All Systems Operational' : 'Action Required'}
              </span>
            </div>

            {loading ? (
              <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                Memeriksa kondisi lingkungan sistem...
              </div>
            ) : (
              <div>
                {/* FFmpeg Row */}
                <div className="metric-row">
                  <div className="metric-label">
                    <Terminal size={15} color={ffmpeg?.available ? '#34d399' : '#f59e0b'} />
                    <span>FFmpeg Media Transcoder</span>
                  </div>
                  <div className="metric-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {ffmpeg?.available ? (
                      <>
                        <span style={{ color: '#34d399' }}>Available</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                          ({ffmpeg.version?.split(' ')[2] || 'Installed'})
                        </span>
                      </>
                    ) : (
                      <span style={{ color: '#fbbf24' }}>Not Found in PATH</span>
                    )}
                  </div>
                </div>

                {/* ffprobe Row */}
                <div className="metric-row">
                  <div className="metric-label">
                    <Terminal size={15} color={ffprobe?.available ? '#34d399' : '#f59e0b'} />
                    <span>ffprobe Media Inspector</span>
                  </div>
                  <div className="metric-value">
                    {ffprobe?.available ? (
                      <span style={{ color: '#34d399' }}>Available</span>
                    ) : (
                      <span style={{ color: '#fbbf24' }}>Not Found</span>
                    )}
                  </div>
                </div>

                {/* Python Runtime Row */}
                <div className="metric-row">
                  <div className="metric-label">
                    <Cpu size={15} color="#818cf8" />
                    <span>Python Runtime (Backend .venv)</span>
                  </div>
                  <div className="metric-value">
                    v{python?.version || '3.12'} ({python?.system || 'Windows'} {python?.release})
                  </div>
                </div>

                {/* Storage Metrics Row */}
                {disk && (
                  <div style={{ marginTop: 14 }}>
                    <div className="metric-row" style={{ borderBottom: 'none', paddingBottom: 4 }}>
                      <div className="metric-label">
                        <HardDrive size={15} color="#38bdf8" />
                        <span>Kapasitas Penyimpanan Lokal (Workspace)</span>
                      </div>
                      <div className="metric-value">
                        {disk.free_gb} GB bebas dari {disk.total_gb} GB
                      </div>
                    </div>
                    <div className="progress-bar-bg">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${Math.min(100, usedPercent)}%` }}
                      />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        marginTop: 4,
                      }}
                    >
                      <span>Terpakai: {disk.used_gb} GB ({usedPercent}%)</span>
                      <span>Sisa Ruang: {disk.free_percent}%</span>
                    </div>
                  </div>
                )}

                {/* Actionable Guidance Box if FFmpeg is Missing */}
                {systemData?.guidance && (
                  <div className="guidance-box">
                    <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <strong>Petunjuk Pengaturan Windows:</strong>
                      <div style={{ marginTop: 4 }}>{systemData.guidance}</div>
                      <div style={{ marginTop: 6 }}>
                        Buka terminal PowerShell pengguna dan jalankan perintah:
                        <br />
                        <code>winget install Gyan.FFmpeg</code>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Quick Actions & Milestone Status */}
        <div className="col-4">
          {/* New Project Placeholder */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header" style={{ marginBottom: 12 }}>
              <h3 className="card-title">
                <FolderPlus size={16} color="#6366f1" />
                Workflow Video Baru
              </h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Di Milestone 2 (Import & Jobs), Anda akan dapat mengunggah video lokal (MP4/MKV/MOV), mengekstrak metadata ffprobe, dan memproses clipping secara offline.
            </p>
            <button
              disabled
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-muted)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <span>Import Video (Tersedia di M2)</span>
              <ArrowRight size={14} />
            </button>
          </div>

          {/* Roadmap Highlights */}
          <div className="card">
            <div className="card-header" style={{ marginBottom: 10 }}>
              <h3 className="card-title">
                <Layers size={16} color="#38bdf8" />
                Tahapan Roadmap
              </h3>
            </div>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <li style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={14} color="#34d399" />
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                  M1: Foundation & Shell
                </span>
                <span style={{ fontSize: 10, color: '#34d399', marginLeft: 'auto' }}>SELESAI</span>
              </li>
              <li style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--accent-primary)', display: 'inline-block' }} />
                <span style={{ color: 'var(--text-secondary)' }}>
                  M2: Ingestion & Jobs (ffprobe)
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>Berikutnya</span>
              </li>
              <li style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border-strong)', display: 'inline-block' }} />
                <span style={{ color: 'var(--text-muted)' }}>
                  M3: Transkripsi (faster-whisper)
                </span>
              </li>
              <li style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border-strong)', display: 'inline-block' }} />
                <span style={{ color: 'var(--text-muted)' }}>
                  M4: Clip Finder & Rubrik Scoring
                </span>
              </li>
              <li style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border-strong)', display: 'inline-block' }} />
                <span style={{ color: 'var(--text-muted)' }}>
                  M7: AI Creative Studio & Threads Writer
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
