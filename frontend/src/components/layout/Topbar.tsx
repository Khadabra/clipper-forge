import type React from 'react';
import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  HardDrive,
  RefreshCw,
  Activity,
  Layers,
  Zap,
} from 'lucide-react';
import type { SystemCheckResponse } from '../../types/system';
import { fetchTokenSummary } from '../../services/tokensApi';
import { TokenMonitorModal } from './TokenMonitorModal';

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
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [todayTokens, setTodayTokens] = useState<number>(0);

  const ffmpegReady = systemData?.ffmpeg?.available ?? false;
  const diskFreeGb = systemData?.disk_space?.free_gb ?? 0;
  const diskPercent = systemData?.disk_space?.free_percent ?? 0;

  useEffect(() => {
    if (backendConnected) {
      fetchTokenSummary()
        .then((res) => setTodayTokens(res.today_tokens))
        .catch(() => {});
    }
  }, [backendConnected, loading]);

  return (
    <>
      <header
        className="topbar"
        style={{
          borderBottom: '1px solid #27272a',
          backgroundColor: 'rgba(9, 9, 11, 0.92)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div className="topbar-left">
          <div
            className="project-title-badge"
            style={{
              backgroundColor: '#121214',
              border: '1px solid #27272a',
              borderRadius: '6px',
              padding: '4px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Layers size={11} color="#10b981" />
            </div>
            <span style={{ fontWeight: 600, color: '#f4f4f5', letterSpacing: '-0.2px' }}>
              ClipForge Studio
            </span>
            <span style={{ color: '#3f3f46' }}>/</span>
            <span style={{ color: '#a1a1aa', fontWeight: 500, fontSize: 11.5 }}>
              Modern Zinc SaaS Workstation
            </span>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 9999,
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                color: '#34d399',
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
              }}
            >
              PRO
            </span>
          </div>
        </div>

        <div className="topbar-right">
          {/* Gemini Token & Quota Monitor Badge */}
          <button
            type="button"
            id="btn-gemini-token-monitor"
            onClick={() => setIsTokenModalOpen(true)}
            className="status-pill"
            style={{
              cursor: 'pointer',
              backgroundColor: '#121214',
              border: '1px solid #27272a',
              color: '#f4f4f5',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '4px 11px',
              borderRadius: 6,
              transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#3f3f46';
              e.currentTarget.style.backgroundColor = '#18181b';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#27272a';
              e.currentTarget.style.backgroundColor = '#121214';
            }}
            title="Buka Gemini Quota & Token Monitor Real-time"
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: '#10b981',
                boxShadow: '0 0 8px rgba(16, 185, 129, 0.9)',
                display: 'inline-block',
              }}
            />
            <Zap size={12} color="#10b981" />
            <span style={{ fontWeight: 600, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              {todayTokens > 0
                ? `${todayTokens.toLocaleString()} Token`
                : '0 Token'}
            </span>
          </button>

          {/* Backend Connection Indicator */}
          <div
            className={`status-pill ${backendConnected ? 'ready' : 'danger'}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 9px',
              borderRadius: 6,
              border: backendConnected
                ? '1px solid rgba(16, 185, 129, 0.25)'
                : '1px solid rgba(244, 63, 94, 0.3)',
              backgroundColor: backendConnected
                ? 'rgba(16, 185, 129, 0.08)'
                : 'rgba(244, 63, 94, 0.08)',
              color: backendConnected ? '#10b981' : '#f43f5e',
              fontSize: 11,
              fontWeight: 500,
            }}
            title={backendConnected ? 'Backend FastAPI terhubung normal' : 'Terputus dari backend FastAPI...'}
          >
            <Activity size={12} />
            <span>{backendConnected ? 'API Connected' : 'API Offline'}</span>
          </div>

          {/* FFmpeg Indicator */}
          <div
            className={`status-pill ${ffmpegReady ? 'ready' : 'warning'}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 9px',
              borderRadius: 6,
              border: ffmpegReady
                ? '1px solid rgba(16, 185, 129, 0.25)'
                : '1px solid rgba(245, 158, 11, 0.3)',
              backgroundColor: ffmpegReady
                ? 'rgba(16, 185, 129, 0.08)'
                : 'rgba(245, 158, 11, 0.08)',
              color: ffmpegReady ? '#10b981' : '#f59e0b',
              fontSize: 11,
              fontWeight: 500,
            }}
            title={
              ffmpegReady
                ? `FFmpeg Siap: ${systemData?.ffmpeg?.version}`
                : 'FFmpeg tidak ditemukan: Diperlukan untuk perenderan klip'
            }
          >
            {ffmpegReady ? (
              <CheckCircle2 size={12} />
            ) : (
              <AlertTriangle size={12} />
            )}
            <span>{ffmpegReady ? 'FFmpeg Ready' : 'FFmpeg Missing'}</span>
          </div>

          {/* Disk Space Indicator */}
          {systemData?.disk_space && (
            <div
              className={`status-pill ${diskFreeGb > 5 ? 'neutral' : 'warning'}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 9px',
                borderRadius: 6,
                border: '1px solid #27272a',
                backgroundColor: '#141416',
                color: diskFreeGb > 5 ? '#a1a1aa' : '#fbbf24',
                fontSize: 11,
              }}
              title={`Ruang Penyimpanan Bebas: ${diskFreeGb} GB (${diskPercent}% free)`}
            >
              <HardDrive size={12} color="#71717a" />
              <span className="font-mono">{diskFreeGb} GB Free</span>
            </div>
          )}

          {/* Refresh Diagnostics */}
          <button
            onClick={() => {
              onRefresh();
              fetchTokenSummary()
                .then((res) => setTodayTokens(res.today_tokens))
                .catch(() => {});
            }}
            className={`refresh-btn ${loading ? 'spinning' : ''}`}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid #27272a',
              backgroundColor: '#141416',
              color: '#a1a1aa',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: loading ? 'wait' : 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#3f3f46';
              e.currentTarget.style.color = '#f4f4f5';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#27272a';
              e.currentTarget.style.color = '#a1a1aa';
            }}
            title="Refresh diagnosa sistem & status kuota"
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </header>

      {/* Gemini Quota & Token Monitor Modal */}
      <TokenMonitorModal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
        onDataUpdated={(res) => setTodayTokens(res.today_tokens)}
      />
    </>
  );
};
