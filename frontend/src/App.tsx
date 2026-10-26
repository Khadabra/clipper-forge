import { useState, useEffect, useCallback } from 'react';
import { Topbar } from './components/layout/Topbar';
import { Sidebar } from './components/layout/Sidebar';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { fetchHealth, fetchSystemCheck } from './services/api';
import type { SystemCheckResponse } from './types/system';
import { Construction, ArrowLeft } from 'lucide-react';

export function App() {
  const [currentRoute, setCurrentRoute] = useState<string>('dashboard');
  const [systemData, setSystemData] = useState<SystemCheckResponse | null>(null);
  const [backendConnected, setBackendConnected] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  const loadSystemDiagnostics = useCallback(async () => {
    setLoading(true);
    try {
      // First verify health
      await fetchHealth();
      setBackendConnected(true);

      // Fetch detailed diagnostics
      const data = await fetchSystemCheck();
      setSystemData(data);
    } catch (err) {
      console.error('Failed to communicate with backend API:', err);
      setBackendConnected(false);
      setSystemData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSystemDiagnostics();
  }, [loadSystemDiagnostics]);

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <Sidebar
        currentRoute={currentRoute}
        onNavigate={(route) => setCurrentRoute(route)}
        systemStatus={
          !backendConnected
            ? 'unknown'
            : systemData?.status === 'ready'
            ? 'ready'
            : 'degraded'
        }
      />

      {/* Main Content Area */}
      <div className="main-wrapper">
        <Topbar
          systemData={systemData}
          loading={loading}
          onRefresh={loadSystemDiagnostics}
          backendConnected={backendConnected}
        />

        <main className="content-area">
          {currentRoute === 'dashboard' ? (
            <DashboardPage
              systemData={systemData}
              loading={loading}
            />
          ) : (
            /* Planned Feature Placeholder View */
            <div
              style={{
                maxWidth: 750,
                margin: '60px auto',
                textAlign: 'center',
                padding: '40px 30px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(99, 102, 241, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 20px auto',
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                }}
              >
                <Construction size={26} color="#818cf8" />
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
                Modul Dijadwalkan (Milestone Berikutnya)
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
                Sesuai prinsip pengembangan terstruktur ClipForge Studio, fitur{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{currentRoute}</strong> akan diimplementasikan
                setelah fondasi inti (M1) diverifikasi dan berjalan stabil. Tidak ada mockup palsu yang disamarkan
                sebagai fitur operasional.
              </p>
              <button
                onClick={() => setCurrentRoute('dashboard')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 18px',
                  background: 'var(--accent-primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <ArrowLeft size={14} />
                Kembali ke Dashboard
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
