/**
 * features/projects/ProjectList.tsx
 * Clean list of previously uploaded projects.
 */
import type React from 'react';
import { Film, Trash2, FolderOpen } from 'lucide-react';
import type { ProjectListItem } from '../../types/project';
import {
  formatDuration,
  getResolutionLabel,
  formatFileSize,
  formatRelativeDate,
} from '../../types/project';

interface Props {
  projects: ProjectListItem[];
  onSelect?: (project: ProjectListItem) => void;
  onDelete?: (id: string) => void;
  deletingId?: string | null;
}

export const ProjectList: React.FC<Props> = ({
  projects,
  onSelect,
  onDelete,
  deletingId,
}) => {
  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <FolderOpen size={16} />
        </div>
        <div>Belum ada proyek.</div>
        <div style={{ marginTop: 4, fontSize: 12 }}>
          Unggah video pertama Anda di atas.
        </div>
      </div>
    );
  }

  return (
    <div id="project-list" className="project-list">
      {projects.map((proj) => (
        <div
          key={proj.id}
          id={`project-row-${proj.id}`}
          className="project-row"
          onClick={() => onSelect?.(proj)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onSelect?.(proj)}
          aria-label={`Buka proyek: ${proj.title}`}
        >
          {/* Thumbnail preview with duration badge */}
          <div className="project-row-thumb" aria-hidden>
            {proj.thumbnail_url ? (
              <img src={proj.thumbnail_url} alt="" />
            ) : (
              <Film size={14} />
            )}
            {proj.duration ? (
              <span className="project-thumb-duration">{formatDuration(proj.duration)}</span>
            ) : null}
          </div>

          {/* Structured Info Card */}
          <div className="project-row-info">
            <div className="project-row-top">
              <span className="project-row-title" title={proj.title}>
                {proj.title}
              </span>
              {onDelete && (
                <button
                  id={`btn-delete-${proj.id}`}
                  className="project-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(proj.id);
                  }}
                  disabled={deletingId === proj.id}
                  aria-label={`Hapus proyek ${proj.title}`}
                  title="Hapus proyek"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>

            <div className="project-row-meta">
              <span>{getResolutionLabel(proj.height)}</span>
              <span>·</span>
              <span>{formatFileSize(proj.file_size_bytes)}</span>
            </div>

            <div className="project-row-bottom">
              <span
                className={`status-pill ${
                  proj.status === 'ready'
                    ? 'ready'
                    : proj.status === 'failed'
                    ? 'danger'
                    : 'neutral'
                }`}
              >
                {proj.status === 'ready'
                  ? 'Siap'
                  : proj.status === 'failed'
                  ? 'Gagal'
                  : proj.status === 'processing'
                  ? 'Diproses'
                  : 'Diunggah'}
              </span>
              <span className="project-row-date">{formatRelativeDate(proj.created_at)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
