/**
 * components/layout/TokenMonitorModal.tsx — Gemini AI Token Usage & Quota Monitor Modal.
 *
 * Clean Zinc Workstation Design (#09090b, border #27272a).
 * Displays real-time Gemini token metrics, daily free quota percentage,
 * feature breakdown, and recent API invocation logs.
 */
import type React from 'react';
import { useState, useEffect } from 'react';
import {
  X,
  Zap,
  RefreshCw,
  Cpu,
  BarChart2,
  Clock,
  Layers,
  Sparkles,
  TrendingUp,
  Share2,
} from 'lucide-react';
import { fetchTokenSummary } from '../../services/tokensApi';
import type { TokenSummaryResponse } from '../../types/token';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onDataUpdated?: (data: TokenSummaryResponse) => void;
}

const FEATURE_META: Record<
  string,
  { label: string; color: string; bg: string; icon: React.ReactNode }
> = {
  clip_finder: {
    label: 'Kurasi Klip AI',
    color: '#818cf8',
    bg: 'rgba(129, 140, 248, 0.15)',
    icon: <Sparkles size={12} color="#818cf8" />,
  },
  seo_title: {
    label: 'SEO & Viral Title',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.15)',
    icon: <TrendingUp size={12} color="#10b981" />,
  },
  social_copy: {
    label: 'Publishing Copywriter',
    color: '#38bdf8',
    bg: 'rgba(56, 189, 248, 0.15)',
    icon: <Share2 size={12} color="#38bdf8" />,
  },
};

export const TokenMonitorModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onDataUpdated,
}) => {
  const [data, setData] = useState<TokenSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const summary = await fetchTokenSummary();
      setData(summary);
      onDataUpdated?.(summary);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat metrik token.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const todayTokens = data?.today_tokens ?? 0;
  const freeLimit = data?.free_quota_limit ?? 1_000_000;
  const quotaUsedPct = data?.quota_used_percent ?? 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 680,
          backgroundColor: '#09090b',
          border: '1px solid #27272a',
          borderRadius: 10,
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          overflow: 'hidden',
          color: '#f4f4f5',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid #27272a',
            backgroundColor: '#121214',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
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
              <Zap size={16} color="#10b981" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f4f4f5' }}>
                Gemini AI Quota & Token Monitor
              </div>
              <div style={{ fontSize: 11, color: '#71717a' }}>
                Pelacakan kuota token harian & transparansi konsumsi API lokal
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              style={{
                padding: '5px 10px',
                borderRadius: 5,
                border: '1px solid #3f3f46',
                backgroundColor: '#18181b',
                color: '#e4e4e7',
                fontSize: 11,
                fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
              title="Refresh metrik token dari server"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              <span>Refresh Data</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px',
                color: '#71717a',
                border: 'none',
                backgroundColor: 'transparent',
                borderRadius: 5,
                cursor: 'pointer',
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div
          style={{
            padding: '16px 18px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {error && (
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 6,
                color: '#f87171',
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}

          {/* Metric Cards Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 10,
            }}
          >
            {/* Card 1: Today Usage */}
            <div
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 8,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#a1a1aa' }}>Token Hari Ini (UTC)</span>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    backgroundColor: '#10b981',
                    boxShadow: '0 0 6px rgba(16, 185, 129, 0.6)',
                  }}
                />
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#10b981' }}>
                {todayTokens.toLocaleString()}
              </div>
              <span style={{ fontSize: 10, color: '#71717a' }}>
                dari {freeLimit.toLocaleString()} kuota harian ({quotaUsedPct}%)
              </span>
            </div>

            {/* Card 2: Today Requests */}
            <div
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 8,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#a1a1aa' }}>Permintaan API Hari Ini</span>
                <Cpu size={14} color="#818cf8" />
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#f4f4f5' }}>
                {data?.today_requests ?? 0}{' '}
                <span style={{ fontSize: 12, fontWeight: 600, color: '#71717a' }}>calls</span>
              </div>
              <span style={{ fontSize: 10, color: '#71717a' }}>
                All-time: {(data?.all_time_requests ?? 0).toLocaleString()} calls
              </span>
            </div>

            {/* Card 3: All-Time Tokens */}
            <div
              style={{
                backgroundColor: '#121214',
                border: '1px solid #27272a',
                borderRadius: 8,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#a1a1aa' }}>Total Token All-Time</span>
                <BarChart2 size={14} color="#38bdf8" />
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#38bdf8' }}>
                {(data?.all_time_tokens ?? 0).toLocaleString()}
              </div>
              <span style={{ fontSize: 10, color: '#71717a' }}>
                Status: Kuota Gratis Aktif
              </span>
            </div>
          </div>

          {/* Daily Quota Progress Bar */}
          <div
            style={{
              backgroundColor: '#121214',
              border: '1px solid #27272a',
              borderRadius: 8,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#f4f4f5' }}>
                Penggunaan Kuota Gratis Gemini Flash (1.000.000 Token/Hari)
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981' }}>
                {quotaUsedPct}%
              </span>
            </div>

            <div
              style={{
                height: 8,
                backgroundColor: '#18181b',
                borderRadius: 4,
                overflow: 'hidden',
                border: '1px solid #27272a',
                display: 'flex',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.max(1, quotaUsedPct))}%`,
                  backgroundColor: quotaUsedPct > 80 ? '#ef4444' : '#10b981',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* Feature Distribution Breakdown */}
          <div
            style={{
              backgroundColor: '#121214',
              border: '1px solid #27272a',
              borderRadius: 8,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Layers size={14} color="#a1a1aa" />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#f4f4f5' }}>
                Distribusi Token Berdasarkan Fitur
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
              }}
            >
              {Object.entries(FEATURE_META).map(([key, meta]) => {
                const item = data?.breakdown?.[key];
                const tokens = item?.tokens ?? 0;
                const reqs = item?.requests ?? 0;
                const pct = item?.percentage ?? 0;

                return (
                  <div
                    key={key}
                    style={{
                      backgroundColor: '#18181b',
                      border: '1px solid #27272a',
                      borderRadius: 6,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      {meta.icon}
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#f4f4f5' }}>
                        {meta.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: meta.color }}>
                      {tokens.toLocaleString()}{' '}
                      <span style={{ fontSize: 10, color: '#71717a' }}>({pct}%)</span>
                    </div>
                    <span style={{ fontSize: 9.5, color: '#a1a1aa' }}>
                      {reqs} permintaan API
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent API Invocation Logs */}
          <div
            style={{
              backgroundColor: '#121214',
              border: '1px solid #27272a',
              borderRadius: 8,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={14} color="#a1a1aa" />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#f4f4f5' }}>
                  Riwayat 5 Pemanggilan API Terakhir
                </span>
              </div>
              <span style={{ fontSize: 10, color: '#71717a' }}>Audit Log Presisi</span>
            </div>

            {data?.recent_logs && data.recent_logs.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  maxHeight: 180,
                  overflowY: 'auto',
                }}
              >
                {data.recent_logs.slice(0, 5).map((log) => {
                  const meta = FEATURE_META[log.feature_name] || {
                    label: log.feature_name,
                    color: '#a1a1aa',
                    bg: 'rgba(255, 255, 255, 0.05)',
                  };
                  const timeStr = new Date(log.created_at).toLocaleTimeString('id-ID', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  });

                  return (
                    <div
                      key={log.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderRadius: 4,
                        backgroundColor: '#18181b',
                        border: '1px solid #27272a',
                        fontSize: 11,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#71717a', fontSize: 10 }}>{timeStr}</span>
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 3,
                            backgroundColor: meta.bg,
                            color: meta.color,
                          }}
                        >
                          {meta.label}
                        </span>
                        <span style={{ fontSize: 10, color: '#71717a' }}>
                          {log.model_name}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: '#71717a' }}>
                          In: {log.prompt_tokens} / Out: {log.candidate_tokens}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981' }}>
                          +{log.total_tokens} Tkn
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  padding: '16px',
                  textAlign: 'center',
                  fontSize: 11,
                  color: '#71717a',
                  backgroundColor: '#18181b',
                  borderRadius: 6,
                }}
              >
                Belum ada catatan pemanggilan API Gemini hari ini.
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '10px 18px',
            borderTop: '1px solid #27272a',
            backgroundColor: '#121214',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 10.5, color: '#71717a' }}>
            Fallback lokal otomatis aktif jika API key Gemini kosong atau kuota habis.
          </span>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #3f3f46',
              backgroundColor: '#27272a',
              color: '#f4f4f5',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
