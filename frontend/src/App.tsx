import { useState, useEffect, useCallback } from 'react';
import { Topbar } from './components/layout/Topbar';
import { Sidebar } from './components/layout/Sidebar';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { fetchHealth, fetchSystemCheck } from './services/api';
import type { SystemCheckResponse } from './types/system';
import { Construction, ArrowLeft } from 'lucide-react';

type Route = 'dashboard' | 'projects' | string;

export function App() {
  const [currentRoute, setCurrentRoute] = useState<Route>('dashboard');
  const [systemData, setSystemData] = useState<SystemCheckResponse | null>(null);
  const [backendConnected, setBackendConnected] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  const loadSystemDiagnostics = useCallback(async () => {
    setLoading(true);
    try {
      await fetchHealth();
      setBackendConnected(true);
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
              onNavigateToProjects={() => setCurrentRoute('projects')}
            />
          ) : currentRoute === 'projects' ? (
            <ProjectsPage />
          ) : (
            /* Planned feature placeholder */
            <div
              style={{
                maxWidth: 680,
                margin: '48px auto',
                textAlign: 'center',
                padding: '36px 28px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-medium)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 18px auto',
                  color: 'var(--text-muted)',
                }}
              >
                <Construction size={22} />
              </div>
              <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>
                Modul Dijadwalkan
              </h2>
              <p
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                  marginBottom: 22,
                  lineHeight: 1.6,
                }}
              >
                Fitur <strong style={{ color: 'var(--text-primary)' }}>{currentRoute}</strong>{' '}
                akan diimplementasikan pada milestone berikutnya.
              </p>
              <button
                onClick={() => setCurrentRoute('dashboard')}
                className="btn btn-ghost"
                style={{ display: 'inline-flex' }}
              >
                <ArrowLeft size={13} />
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
