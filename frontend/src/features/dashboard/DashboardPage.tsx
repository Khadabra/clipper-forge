import type React from 'react';
import {
  CheckCircle2,
  HardDrive,
  Cpu,
  Terminal,
  ShieldAlert,
  Server,
  Layers,
  CheckCheck,
} from 'lucide-react';
import type { SystemCheckResponse } from '../../types/system';

interface DashboardPageProps {
  systemData: SystemCheckResponse | null;
  loading: boolean;
  onNavigateToProjects?: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  systemData,
  loading,
  onNavigateToProjects,
}) => {
  const ffmpeg = systemData?.ffmpeg;
  const ffprobe = systemData?.ffprobe;
  const python = systemData?.python;
  const disk = systemData?.disk_space;

  const usedPercent = disk ? Math.round((disk.used_gb / disk.total_gb) * 100) : 0;
  const diskWarn = usedPercent > 85;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Page heading */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.3px',
            marginBottom: 4,
          }}
        >
          System Overview
        </h1>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Verifikasi dependensi backend, kapasitas penyimpanan, dan status milestone.
        </p>
      </div>

      <div className="dashboard-grid">
        {/* Left Column: System Diagnostics */}
        <div className="col-8">
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">
                  <Server size={15} color="var(--text-muted)" />
                  System Diagnostics
                </h2>
                <p className="card-description">
                  Dependensi backend dan status pemrosesan media.
                </p>
              </div>
              <span
                className={`status-pill ${
                  systemData?.status === 'ready' ? 'ready' : 'warning'
                }`}
              >
                {systemData?.status === 'ready' ? 'Operational' : 'Action Required'}
              </span>
            </div>

            {loading ? (
              <div
                style={{
                  padding: '28px 0',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                }}
              >
                Memeriksa kondisi sistem...
              </div>
            ) : (
              <div>
                {/* FFmpeg Row */}
                <div className="metric-row">
                  <div className="metric-label">
                    <Terminal size={13} color={ffmpeg?.available ? 'var(--status-ok)' : 'var(--status-warn)'} />
                    <span>FFmpeg Media Transcoder</span>
                  </div>
                  <div className="metric-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {ffmpeg?.available ? (
                      <>
                        <span style={{ color: 'var(--status-ok)' }}>Available</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                          {ffmpeg.version?.split(' ')[2] || 'Installed'}
                        </span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--status-warn)' }}>Not Found in PATH</span>
                    )}
                  </div>
                </div>

                {/* ffprobe Row */}
                <div className="metric-row">
                  <div className="metric-label">
                    <Terminal size={13} color={ffprobe?.available ? 'var(--status-ok)' : 'var(--status-warn)'} />
                    <span>ffprobe Media Inspector</span>
                  </div>
                  <div className="metric-value">
                    {ffprobe?.available ? (
                      <span style={{ color: 'var(--status-ok)' }}>Available</span>
                    ) : (
                      <span style={{ color: 'var(--status-warn)' }}>Not Found</span>
                    )}
                  </div>
                </div>

                {/* Python Runtime Row */}
                <div className="metric-row">
                  <div className="metric-label">
                    <Cpu size={13} color="var(--text-muted)" />
                    <span>Python Runtime (.venv)</span>
                  </div>
                  <div className="metric-value">
                    v{python?.version || '3.12'} ({python?.system || 'Windows'})
                  </div>
                </div>

                {/* Storage Row */}
                {disk && (
                  <div style={{ marginTop: 12 }}>
                    <div className="metric-row" style={{ borderBottom: 'none', paddingBottom: 4 }}>
                      <div className="metric-label">
                        <HardDrive size={13} color="var(--text-muted)" />
                        <span>Penyimpanan Lokal</span>
                      </div>
                      <div className="metric-value">
                        {disk.free_gb} GB bebas / {disk.total_gb} GB
                      </div>
                    </div>
                    <div className="progress-bar-bg">
                      <div
                        className={`progress-bar-fill${diskWarn ? ' warn' : ''}`}
                        style={{ width: `${Math.min(100, usedPercent)}%` }}
                      />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        marginTop: 4,
                      }}
                    >
                      <span>Terpakai: {disk.used_gb} GB ({usedPercent}%)</span>
                      <span>Sisa: {disk.free_percent}%</span>
                    </div>
                  </div>
                )}

                {/* Guidance box if FFmpeg is missing */}
                {systemData?.guidance && (
                  <div className="guidance-box">
                    <ShieldAlert size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <strong>Cara menginstall FFmpeg di Windows:</strong>
                      <div style={{ marginTop: 4 }}>
                        Buka PowerShell dan jalankan:{' '}
                        <code>winget install Gyan.FFmpeg</code>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Roadmap status */}
        <div className="col-4">
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header" style={{ marginBottom: 12 }}>
              <h3 className="card-title">
                <Layers size={14} color="var(--text-muted)" />
                Roadmap
              </h3>
            </div>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'M1: Foundation & Shell', done: true, active: false },
                { label: 'M2: Ingestion & Jobs (ffprobe)', done: true, active: true },
                { label: 'M3: Transkripsi (faster-whisper)', done: false, active: false },
                { label: 'M4: Clip Finder & Rubrik Scoring', done: false, active: false },
                { label: 'M7: AI Creative Studio', done: false, active: false },
              ].map((item) => (
                <li
                  key={item.label}
                  style={{
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    opacity: !item.done && !item.active ? 0.45 : 1,
                  }}
                >
                  {item.done ? (
                    <CheckCircle2 size={13} color="var(--status-ok)" style={{ flexShrink: 0 }} />
                  ) : (
                    <span
                      style={{
                        width: 13,
                        height: 13,
                        borderRadius: '50%',
                        border: `1.5px solid ${item.active ? 'var(--text-primary)' : 'var(--border-medium)'}`,
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span
                    style={{
                      color: item.done || item.active ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontWeight: item.active ? 600 : 400,
                    }}
                  >
                    {item.label}
                  </span>
                  {item.done && (
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: 9,
                        color: 'var(--status-ok)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                      }}
                    >
                      Selesai
                    </span>
                  )}
                  {item.active && !item.done && (
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: 9,
                        color: 'var(--text-muted)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                      }}
                    >
                      Aktif
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Quick action: go to Projects */}
          <div className="card">
            <div className="card-header" style={{ marginBottom: 10 }}>
              <h3 className="card-title">
                <CheckCheck size={14} color="var(--status-ok)" />
                M2 Aktif
              </h3>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.6 }}>
              Upload video, ekstrak metadata otomatis via ffprobe, dan kelola proyek yang tersimpan.
            </p>
            <button
              id="btn-go-to-upload"
              className="btn btn-primary btn-full"
              onClick={onNavigateToProjects}
              type="button"
            >
              Buka Upload Video
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
