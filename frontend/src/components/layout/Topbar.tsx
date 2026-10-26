import type React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  HardDrive,
  RefreshCw,
  Activity,
  Layers,
} from 'lucide-react';
import type { SystemCheckResponse } from '../../types/system';

interface TopbarProps {
  systemData: SystemCheckResponse | null;
  loading: boolean;
  onRefresh: () => void;
  backendConnected: boolean;
}

export const Topbar: React.FC<TopbarProps> = ({
  systemData,
  loading,
  onRefresh,
  backendConnected,
}) => {
  const ffmpegReady = systemData?.ffmpeg?.available ?? false;
  const diskFreeGb = systemData?.disk_space?.free_gb ?? 0;
  const diskPercent = systemData?.disk_space?.free_percent ?? 0;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="project-title-badge">
          <Layers size={14} color="#818cf8" />
          <span>ClipForge Studio</span>
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>M1: Foundation</span>
        </div>
      </div>

      <div className="topbar-right">
        {/* Backend Connection Indicator */}
        <div
          className={`status-pill ${backendConnected ? 'ready' : 'danger'}`}
          title={backendConnected ? 'Backend FastAPI is connected' : 'Connecting to backend...'}
        >
          <Activity size={13} />
          <span>{backendConnected ? 'API Connected' : 'API Disconnected'}</span>
        </div>

        {/* FFmpeg Indicator */}
        <div
          className={`status-pill ${ffmpegReady ? 'ready' : 'warning'}`}
          title={
            ffmpegReady
              ? `FFmpeg Ready: ${systemData?.ffmpeg?.version}`
              : 'FFmpeg missing: Required for clipping & rendering'
          }
        >
          {ffmpegReady ? (
            <CheckCircle2 size={13} />
          ) : (
            <AlertTriangle size={13} />
          )}
          <span>{ffmpegReady ? 'FFmpeg Ready' : 'FFmpeg Missing'}</span>
        </div>

        {/* Disk Space Indicator */}
        {systemData?.disk_space && (
          <div
            className={`status-pill ${diskFreeGb > 5 ? 'neutral' : 'warning'}`}
            title={`Free Storage: ${diskFreeGb} GB (${diskPercent}% free)`}
          >
            <HardDrive size={13} />
            <span className="font-mono">{diskFreeGb} GB Free</span>
          </div>
        )}

        {/* Refresh Diagnostics */}
        <button
          onClick={onRefresh}
          className={`refresh-btn ${loading ? 'spinning' : ''}`}
          title="Refresh system diagnostics"
          disabled={loading}
        >
          <RefreshCw size={14} />
        </button>
      </div>
    </header>
  );
};
