/**
 * features/projects/YouTubeIngestZone.tsx
 * Clean Zinc YouTube URL ingestion form.
 */
import type React from 'react';
import { useState } from 'react';
import { ArrowRight, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { ingestYouTubeVideo } from '../../services/projectsApi';

interface Props {
  onIngestStarted: (projectId: string, jobId: string, initialUrl: string) => void;
}

export const YouTubeIngestZone: React.FC<Props> = ({ onIngestStarted }) => {
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Masukkan tautan video YouTube terlebih dahulu.');
      return;
    }

    // Basic client-side check
    if (!trimmed.includes('youtube.com') && !trimmed.includes('youtu.be')) {
      setError('Format tautan tidak dikenali. Harap gunakan link youtube.com atau youtu.be.');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const resp = await ingestYouTubeVideo(trimmed);
      onIngestStarted(resp.project_id, resp.job_id, trimmed);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menghubungi server untuk mengunduh video.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ padding: '10px 0' }}>
      <div style={{ marginBottom: 14 }}>
        <label
          htmlFor="youtube-url-input"
          style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: 8,
          }}
        >
          Tautan Video YouTube
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="youtube-url-input"
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            placeholder="https://www.youtube.com/watch?v=... atau https://youtu.be/..."
            disabled={submitting}
            style={{
              flex: 1,
              padding: '10px 14px',
              fontSize: 13,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-app)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              outline: 'none',
              fontFamily: 'var(--font-sans)',
            }}
          />
          <button
            id="btn-process-youtube"
            className="btn btn-primary"
            type="submit"
            disabled={submitting || !url.trim()}
            style={{ padding: '0 18px', whiteSpace: 'nowrap' }}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="spin" />
                Memulai...
              </>
            ) : (
              <>
                Proses Video
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            marginBottom: 12,
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            color: 'var(--accent-red, #ef4444)',
            fontSize: 12,
          }}
        >
          <AlertCircle size={14} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Feature note chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'var(--bg-app)',
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-color)',
          }}
        >
          <Sparkles size={11} color="var(--accent-amber, #f59e0b)" />
          Format terbaik maks 1080p MP4
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            background: 'var(--bg-app)',
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-color)',
          }}
        >
          Ekstraksi otomatis metadata via ffprobe
        </div>
      </div>
    </form>
  );
};
