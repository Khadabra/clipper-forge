import type React from 'react';
import {
  LayoutDashboard,
  Film,
  Scissors,
  Sliders,
  Type,
  Music,
  Download,
  Sparkles,
  MessageSquareShare,
  Lightbulb,
  Repeat,
  Calendar,
  Bookmark,
  Palette,
  Settings,
} from 'lucide-react';

interface SidebarProps {
  currentRoute: string;
  onNavigate: (routeId: string) => void;
  systemStatus: 'ready' | 'degraded' | 'unknown';
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  isPlanned?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentRoute,
  onNavigate,
  systemStatus,
}) => {
  const groups: NavGroup[] = [
    {
      title: 'Media & Editing',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'projects', label: 'Projects / Import', icon: Film },       // M2: Active
        { id: 'clip-finder', label: 'Clip Finder', icon: Scissors, isPlanned: true },
        { id: 'editor', label: 'Video Editor', icon: Sliders, isPlanned: true },
        { id: 'captions', label: 'Caption Studio', icon: Type, isPlanned: true },
        { id: 'music', label: 'Music Studio', icon: Music, isPlanned: true },
        { id: 'exports', label: 'Exports', icon: Download, isPlanned: true },
      ],
    },
    {
      title: 'AI Studio & Publishing',
      items: [
        { id: 'ai-studio', label: 'AI Creative Studio', icon: Sparkles, isPlanned: true },
        { id: 'threads-writer', label: 'Threads Writer', icon: MessageSquareShare, isPlanned: true },
        { id: 'raw-ideas', label: 'Raw Ideas to Content', icon: Lightbulb, isPlanned: true },
        { id: 'repurposing', label: 'Content Repurposing', icon: Repeat, isPlanned: true },
        { id: 'calendar', label: 'Content Calendar', icon: Calendar, isPlanned: true },
        { id: 'ideas-library', label: 'Ideas & Copy Library', icon: Bookmark, isPlanned: true },
      ],
    },
    {
      title: 'Workspace & System',
      items: [
        { id: 'brand-kit', label: 'Style Presets / Brand Kit', icon: Palette, isPlanned: true },
        { id: 'settings', label: 'System & AI Settings', icon: Settings, isPlanned: true },
      ],
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand-icon">
          <Film size={14} color="var(--bg-app)" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="brand-name">ClipForge Studio</span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Local Creator Workstation</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="nav-group-title">{group.title}</div>
            <ul className="nav-list">
              {group.items.map((item) => {
                const IconComponent = item.icon;
                const isActive = currentRoute === item.id;

                return (
                  <li key={item.id}>
                    <button
                      className={`nav-item-btn ${isActive ? 'active' : ''}`}
                      onClick={() => onNavigate(item.id)}
                    >
                      <div className="nav-item-content">
                        <IconComponent className="nav-icon" />
                        <span>{item.label}</span>
                      </div>
                      {item.isPlanned && (
                        <span className="planned-badge">M{item.id === 'projects' ? '2' : '4+'}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="local-mode-pill">
          <span
            className={`pulse-dot ${
              systemStatus === 'ready'
                ? ''
                : systemStatus === 'degraded'
                ? 'warning'
                : 'danger'
            }`}
          />
          <span style={{ fontWeight: 500 }}>
            {systemStatus === 'ready'
              ? 'Local System Ready'
              : systemStatus === 'degraded'
              ? 'Environment Degraded'
              : 'Checking System...'}
          </span>
        </div>
      </div>
    </aside>
  );
};
