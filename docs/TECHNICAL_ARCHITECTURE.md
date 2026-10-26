# Technical Architecture

## 1. Constraints
- Windows desktop development.
- Local-first; no paid API required.
- 16 GB RAM and RTX 4050: avoid running multiple heavy models simultaneously.
- Core functions must degrade gracefully if an optional model is missing.
- All long-running work belongs in background jobs.

## 2. Stack
Frontend:
- React + TypeScript + Vite.
- Choose Tailwind CSS or CSS Modules during foundation milestone.
- React Query or equivalent may be used for API/job state if justified.
- Video preview via HTML5 video.

Backend:
- Python + FastAPI + Pydantic.
- SQLite for project/job metadata.
- Worker process for transcription/rendering.
- FFmpeg/ffprobe subprocesses using argument arrays, never shell-composed user input.

AI/media:
- faster-whisper for local transcription.
- Ollama adapter for local text model (optional).
- Gemini API adapter optional, disabled by default, with explicit provider configuration and no assumption that Gemini Pro includes API credits.
- FFmpeg for trimming, scaling/cropping, subtitle burn-in, audio mix, fades, and export.
- Face detection and audio generation remain optional modules until evaluated.

## 3. Service boundaries
- `ProjectService`: project metadata and source paths.
- `MediaProbeService`: validate and inspect media.
- `IngestionService`: local upload and permitted source adapters.
- `TranscriptionService`: audio extraction and timestamped transcript.
- `ClipSelectionService`: candidate windows and structured AI analysis.
- `ScoringService`: deterministic score aggregation and context-risk penalty.
- `ReframingService`: crop strategies and optional subject tracking.
- `CaptionService`: SRT/ASS generation and caption style config.
- `MusicLibraryService`: local audio metadata and license fields.
- `AudioMixService`: gain, fade, loop/trim, ducking.
- `CreativeAssistantService`: brainstorm/copy generation through provider adapter.
- `RepurposingService`: transforms clip transcripts and raw notes into multi-post threads, carousel slides, and newsletter summaries.
- `CalendarService`: scheduling items, pipeline stages (idea, draft, scheduled, published), and date queries.
- `RenderService`: build safe FFmpeg arguments and produce output.
- `ExportService`: list and validate output artifacts.
- `JobService`: queue/state/progress/cancel/retry.
- `SettingsService`: configuration and provider readiness.

## 4. Suggested folder structure
```text
clipforge-studio/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── dashboard/
│   │   │   ├── projects/
│   │   │   ├── clip-finder/
│   │   │   ├── editor/
│   │   │   ├── captions/
│   │   │   ├── music/
│   │   │   ├── assistant/
│   │   │   ├── ideas-library/
│   │   │   ├── presets/
│   │   │   └── exports/
│   │   ├── lib/
│   │   ├── types/
│   │   └── main.tsx
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── api/routes/
│   │   ├── core/
│   │   ├── db/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── providers/
│   │   ├── workers/
│   │   └── main.py
│   └── tests/
├── storage/
│   ├── projects/
│   ├── temp/
│   ├── music-library/
│   └── exports/
├── docs/
├── .env.example
├── .gitignore
└── README.md
```

## 5. Initial API contract
- `GET /api/health`
- `GET /api/system/check`
- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/{project_id}`
- `POST /api/projects/{project_id}/upload`
- `POST /api/projects/{project_id}/analyze`
- `GET /api/jobs/{job_id}`
- `POST /api/jobs/{job_id}/cancel`
- `GET /api/projects/{project_id}/transcript`
- `GET /api/projects/{project_id}/clips`
- `PATCH /api/clips/{clip_id}`
- `POST /api/clips/{clip_id}/render`
- `PATCH /api/clips/{clip_id}/captions`
- `GET /api/projects/{project_id}/music-library`
- `POST /api/clips/{clip_id}/mix-preview`
- `POST /api/assistant/generate`
- `GET /api/ideas`
- `POST /api/ideas`
- `PATCH /api/ideas/{idea_id}`
- `GET /api/exports`
- `GET /api/exports/{export_id}`
- `GET /api/settings/providers`

## 6. Data model (initial)
- `Project`: id, name, source_path, source_kind, duration, width, height, fps, audio_present, language, created_at, updated_at.
- `Job`: id, project_id, type, state, progress, current_step, error_code, error_message, started_at, finished_at, cancel_requested.
- `TranscriptSegment`: id, project_id, start, end, text, confidence (nullable).
- `ClipCandidate`: id, project_id, start, end, title, hook, rationale, transcript_excerpt, score_components_json, context_risk, status.
- `CaptionSegment`: id, clip_id, start, end, text, style_json.
- `AudioAsset`: id, path, title, mood, energy, bpm, duration, source, license, attribution, notes.
- `EditProject`: id, clip_id, edit_json, version, updated_at.
- `Idea`: id, project_id nullable, clip_id nullable, kind, content_json, tags_json, status, created_at.
- `CalendarItem`: id, project_id nullable, clip_id nullable, idea_id nullable, title, platform, scheduled_date, status, notes, created_at.
- `ContentStrategy`: id, niche, target_audience, content_pillars_json, monetization_goals_json, updated_at.
- `Export`: id, project_id, clip_id, output_path, format, status, metadata_json, created_at.
- `ProviderConfig`: provider, enabled, model, configuration reference (never persist secret values in ordinary rows).

## 7. Job states
`queued → processing → completed | failed | cancelled`
- Progress should be monotonic within a job stage where possible.
- Cancellation must stop child processes safely.
- Failure details should be useful without exposing secrets or dumping sensitive paths unnecessarily.
- Prevent duplicate processing jobs for the same stage unless explicitly requested.

## 8. Security and robustness
- Sanitize names and resolve paths under configured storage roots.
- Enforce file size/duration limits through configuration.
- Validate media by probing content, not filename extension alone.
- Use subprocess argument arrays and allowlisted FFmpeg options.
- Avoid arbitrary user-provided filter strings.
- Set timeouts and concurrency limits.
- Never execute generated model text as code or shell commands.
- External providers default disabled and must show a consent/configuration step.
- Keep source, temp, and export directories separate.
- Use safe cleanup with path containment checks.
- Do not log API keys, tokens, full prompts containing private material, or secret config.
- Treat downloaded/remote media as untrusted input.

## 9. Performance
- Run one heavy transcription/model task at a time by default.
- Let user select model size and compute device.
- Show estimates as estimates, not guarantees.
- Cache transcript/probe results when source hash is unchanged.
- Use temporary low-resolution previews before final render.
- Monitor disk space before rendering.
- Keep optional GPU-dependent services isolated and provide CPU fallback when practical.
