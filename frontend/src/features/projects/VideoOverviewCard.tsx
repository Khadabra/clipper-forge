/**
 * features/projects/VideoOverviewCard.tsx
 * Shows metadata, preview player, interactive transcript studio, and background job monitor.
 */
import type React from 'react';
import { useRef, useState } from 'react';
import { ArrowRight, Film } from 'lucide-react';
import type { Project } from '../../types/project';
import {
  formatDuration,
  formatFileSize,
  getResolutionLabel,
  getAspectRatio,
  formatFps,
} from '../../types/project';
import { ProjectJobMonitor } from './ProjectJobMonitor';
import { TranscriptStudio } from './TranscriptStudio';
import { ClipCandidateList } from '../clips/ClipCandidateList';

interface Props {
  project: Project;
  onContinue?: () => void;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export const VideoOverviewCard: React.FC<Props> = ({ project, onContinue }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const videoUrl = `${API_BASE}/storage/projects/${project.id}/source.mp4`;

  const handleSeek = (timeSeconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = timeSeconds;
      videoRef.current.play().catch(() => {
        // Autoplay policy or video not ready
      });
    }
  };

  const handlePlay = () => {
    videoRef.current?.play().catch(() => {});
  };

  const handlePause = () => {
    videoRef.current?.pause();
  };

  const chips = [
    { label: 'Durasi', value: formatDuration(project.duration) },
    { label: 'Resolusi', value: getResolutionLabel(project.height) },
    { label: 'Aspek Rasio', value: getAspectRatio(project.width, project.height) },
    { label: 'Framerate', value: formatFps(project.fps) },
    {
      label: 'Audio',
      value: project.audio_channels ? `${project.audio_channels}ch` : 'Tidak ada',
    },
    { label: 'Ukuran File', value: formatFileSize(project.file_size_bytes) },
  ];

  return (
    <div id={`video-overview-${project.id}`} className="video-overview">
      {/* Video preview */}
      <div className="video-preview">
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          preload="metadata"
          onTimeUpdate={() => {
            if (videoRef.current) {
              setCurrentTime(videoRef.current.currentTime);
            }
          }}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          aria-label={`Preview video: ${project.title}`}
        >
          <track kind="captions" />
        </video>
      </div>

      {/* Title and status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Film size={14} color="var(--text-muted)" />
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '-0.2px',
              }}
            >
              {project.title}
            </span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {project.original_filename}
          </span>
        </div>
        <span
          className={
            project.status === 'clips_ready'
              ? 'status-pill active'
              : project.status === 'transcribed'
              ? 'status-pill active'
              : 'status-pill ready'
          }
          style={{ flexShrink: 0 }}
        >
          {project.status === 'clips_ready'
            ? '✓ Klip Siap'
            : project.status === 'transcribed'
            ? '✓ Ditranskrip'
            : '✓ Siap'}
        </span>
      </div>

      {/* Metadata chips */}
      <div className="metadata-grid">
        {chips.map((chip) => (
          <div key={chip.label} className="meta-chip">
            <div className="meta-chip-label">{chip.label}</div>
            <div className="meta-chip-value">{chip.value}</div>
          </div>
        ))}
      </div>

      {/* Milestone 3: Interactive Transcript Studio */}
      <TranscriptStudio
        projectId={project.id}
        currentTime={currentTime}
        onSeek={handleSeek}
      />

      {/* Milestone 4: Curated Shorts Hub & AI Clip Finder */}
      <ClipCandidateList
        projectId={project.id}
        currentTime={currentTime}
        onSeek={handleSeek}
        onPlay={handlePlay}
        onPause={handlePause}
      />

      {/* Background Job Queue Monitor */}
      <ProjectJobMonitor projectId={project.id} />

      {/* Continue CTA */}
      {onContinue && (
        <button
          id="btn-continue-to-clips"
          className="btn btn-primary btn-full"
          onClick={onContinue}
          type="button"
          style={{ marginTop: 16 }}
        >
          Lanjut ke Editor Vertikal (Milestone 5)
          <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
};
