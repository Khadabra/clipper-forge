/**
 * App.tsx — ClipperForge Studio Main Application.
 *
 * Clean Zinc Workstation UI (#09090b, border #27272a).
 * Unified navigation routing connecting:
 * - Media & Editing: Dashboard, Projects/Ingest, Clip Finder, Video Editor, Caption Studio, Music Studio, Exports
 * - AI Studio & Publishing: AI Creative Studio, Threads Writer, Raw Ideas, Repurposing, Calendar, Ideas & Copy Library
 * - Workspace & System: Brand Kit / Style Presets, System & AI Settings
 *
 * All placeholder 'Modul Dijadwalkan' screens are completely removed.
 * Automatic global active project & clip fallback is maintained across views.
 */
import { useState, useEffect, useCallback } from 'react';
import { Topbar } from './components/layout/Topbar';
import { Sidebar } from './components/layout/Sidebar';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { ClipFinderView } from './features/clips/ClipFinderView';
import { ClipEditorStudio } from './features/clips/ClipEditorStudio';
import { ExportsView } from './features/clips/ExportsView';
import { AiStudioView } from './features/ai/AiStudioView';
import { BrandKitView } from './features/settings/BrandKitView';
import { SystemSettingsView } from './features/settings/SystemSettingsView';
import { fetchHealth, fetchSystemCheck } from './services/api';
import { fetchProjects } from './services/projectsApi';
import { fetchAllClips } from './services/clipsApi';
import type { SystemCheckResponse } from './types/system';
import type { ProjectListItem } from './types/project';
import type { ClipCandidate } from './types/clip';
import { Sliders, Film, Scissors } from 'lucide-react';

type Route =
  | 'dashboard'
  | 'projects'
  | 'clip-finder'
  | 'editor'
  | 'captions'
  | 'music'
  | 'exports'
  | 'ai-studio'
  | 'threads-writer'
  | 'raw-ideas'
  | 'repurposing'
  | 'calendar'
  | 'ideas-library'
  | 'brand-kit'
  | 'settings'
  | string;

export function App() {
  const [currentRoute, setCurrentRoute] = useState<Route>('dashboard');
  const [systemData, setSystemData] = useState<SystemCheckResponse | null>(null);
  const [backendConnected, setBackendConnected] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Global Project & Clip State for Automatic Fallback
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [clips, setClips] = useState<ClipCandidate[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectListItem | null>(null);
  const [activeClip, setActiveClip] = useState<ClipCandidate | null>(null);

  // ── Load System Diagnostics ────────────────────────────────────────────────
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

  // ── Load Global Workstation Projects & Clips with Auto-Fallback ───────────
  const loadWorkstationData = useCallback(async () => {
    try {
      const [loadedProjects, loadedClips] = await Promise.all([
        fetchProjects().catch(() => [] as ProjectListItem[]),
        fetchAllClips().catch(() => [] as ClipCandidate[]),
      ]);

      setProjects(loadedProjects);
      setClips(loadedClips);

      setActiveProject((prev) => {
        if (prev && loadedProjects.some((p) => p.id === prev.id)) return prev;
        return loadedProjects.length > 0 ? loadedProjects[0] : null;
      });

      setActiveClip((prev) => {
        if (prev && loadedClips.some((c) => c.id === prev.id)) return prev;
        return loadedClips.length > 0 ? loadedClips[0] : null;
      });
    } catch (err) {
      console.error('Failed to load workstation projects/clips:', err);
    }
  }, []);

  useEffect(() => {
    loadSystemDiagnostics();
    loadWorkstationData();
  }, [loadSystemDiagnostics, loadWorkstationData]);

  // When activeProject changes, verify or pick corresponding activeClip
  const handleSelectProject = (project: ProjectListItem) => {
    setActiveProject(project);
    const projectClips = clips.filter((c) => c.project_id === project.id);
    if (projectClips.length > 0) {
      setActiveClip(projectClips[0]);
    }
  };

  const handleOpenEditor = (
    clip: ClipCandidate,
    focusSection: 'general' | 'captions' | 'soundboard' = 'general'
  ) => {
    setActiveClip(clip);
    const matchedProject = projects.find((p) => p.id === clip.project_id);
    if (matchedProject) {
      setActiveProject(matchedProject);
    }

    if (focusSection === 'captions') {
      setCurrentRoute('captions');
    } else if (focusSection === 'soundboard') {
      setCurrentRoute('music');
    } else {
      setCurrentRoute('editor');
    }
  };

  const handleClipUpdated = (updatedClip: ClipCandidate) => {
    setClips((prev) => prev.map((c) => (c.id === updatedClip.id ? updatedClip : c)));
    if (activeClip?.id === updatedClip.id) {
      setActiveClip(updatedClip);
    }
  };

  // Determine initial focus section for ClipEditorStudio based on currentRoute
  const editorInitialFocus =
    currentRoute === 'captions'
      ? 'captions'
      : currentRoute === 'music'
      ? 'soundboard'
      : 'general';

  const isEditorRoute =
    currentRoute === 'editor' ||
    currentRoute === 'captions' ||
    currentRoute === 'music';

  const isAiStudioRoute =
    currentRoute === 'ai-studio' ||
    currentRoute === 'threads-writer' ||
    currentRoute === 'raw-ideas' ||
    currentRoute === 'repurposing' ||
    currentRoute === 'calendar' ||
    currentRoute === 'ideas-library';

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
          onRefresh={() => {
            loadSystemDiagnostics();
            loadWorkstationData();
          }}
          backendConnected={backendConnected}
        />

        <main className="content-area">
          {/* 1. Dashboard View */}
          {currentRoute === 'dashboard' && (
            <DashboardPage
              systemData={systemData}
              loading={loading}
              onNavigateToProjects={() => setCurrentRoute('projects')}
            />
          )}

          {/* 2. Projects & Media Ingestion View */}
          {currentRoute === 'projects' && (
            <ProjectsPage
              onOpenEditor={(clip) => handleOpenEditor(clip, 'general')}
            />
          )}

          {/* 3. Clip Finder Curated Shorts View */}
          {currentRoute === 'clip-finder' && (
            <ClipFinderView
              projects={projects}
              activeProject={activeProject}
              onSelectProject={handleSelectProject}
              onOpenEditor={(c) => handleOpenEditor(c, 'general')}
              onNavigateToProjects={() => setCurrentRoute('projects')}
            />
          )}

          {/* 4. Video Editor, Caption Studio, & Music Studio */}
          {isEditorRoute && (
            <>
              {activeClip ? (
                <>
                  {/* Underlay view to maintain background context */}
                  <ClipFinderView
                    projects={projects}
                    activeProject={activeProject}
                    onSelectProject={handleSelectProject}
                    onOpenEditor={(c) => handleOpenEditor(c, 'general')}
                    onNavigateToProjects={() => setCurrentRoute('projects')}
                  />

                  {/* Active Studio Modal with auto-focus */}
                  <ClipEditorStudio
                    clip={activeClip}
                    isOpen={true}
                    onClose={() => setCurrentRoute('clip-finder')}
                    onClipUpdated={handleClipUpdated}
                    initialFocusSection={editorInitialFocus}
                  />
                </>
              ) : (
                /* No clip selected fallback */
                <div
                  style={{
                    maxWidth: 620,
                    margin: '60px auto',
                    textAlign: 'center',
                    padding: '40px 24px',
                    background: 'var(--bg-surface)',
                    border: '1px dashed var(--border-color)',
                    borderRadius: 'var(--radius-lg)',
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-surface-elevated)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 16px auto',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <Sliders size={22} />
                  </div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
                    Belum Ada Klip Terpilih
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
                    Untuk membuka{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>
                      {currentRoute === 'captions'
                        ? 'Caption Studio'
                        : currentRoute === 'music'
                        ? 'Music & Soundboard Studio'
                        : 'Video Editor Studio'}
                    </strong>
                    , pilih atau kurasi klip terlebih dahulu dari video proyek Anda.
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                    <button
                      onClick={() => setCurrentRoute('clip-finder')}
                      className="btn btn-primary"
                    >
                      <Scissors size={14} />
                      Buka Clip Finder
                    </button>
                    <button
                      onClick={() => setCurrentRoute('projects')}
                      className="btn btn-secondary"
                    >
                      <Film size={14} />
                      Upload Video Baru
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* 5. Exports Gallery View */}
          {currentRoute === 'exports' && (
            <ExportsView
              onOpenEditor={(c) => handleOpenEditor(c, 'general')}
              onNavigateToFinder={() => setCurrentRoute('clip-finder')}
              onNavigateToProjects={() => setCurrentRoute('projects')}
            />
          )}

          {/* 6. AI Creative Studio & Publishing Suite */}
          {isAiStudioRoute && (
            <AiStudioView
              activeTab={currentRoute}
              onTabChange={(tab) => setCurrentRoute(tab)}
              clips={clips}
              activeClip={activeClip}
              onSelectClip={(c) => {
                setActiveClip(c);
                const matchedProject = projects.find((p) => p.id === c.project_id);
                if (matchedProject) setActiveProject(matchedProject);
              }}
              onOpenEditor={(c) => handleOpenEditor(c, 'general')}
              onNavigateToFinder={() => setCurrentRoute('clip-finder')}
            />
          )}

          {/* 7. Style Presets / Brand Kit View */}
          {currentRoute === 'brand-kit' && <BrandKitView />}

          {/* 8. System & AI Settings View */}
          {currentRoute === 'settings' && (
            <SystemSettingsView
              systemData={systemData}
              loading={loading}
              onRefresh={() => {
                loadSystemDiagnostics();
                loadWorkstationData();
              }}
              backendConnected={backendConnected}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
