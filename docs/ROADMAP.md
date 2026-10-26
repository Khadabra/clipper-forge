# Roadmap and Milestones

Do not implement every phase at once. Complete, test, and document each milestone.

## M0 — Repository audit and product alignment
- Read all docs.
- Inspect existing files.
- Report contradictions and missing prerequisites.
- Confirm Windows setup assumptions.
- Do not overwrite files blindly.

**Done when:** implementation plan and folder structure are agreed; no code feature is falsely marked complete.

## M1 — Foundation
- React + TypeScript + Vite shell.
- FastAPI app and `/api/health`.
- Configuration and `.env.example`.
- SQLite setup and migrations strategy.
- System check endpoint.
- Logging, test scaffolding, README Windows instructions.
- UI shell/navigation with planned features clearly marked.

**Done when:** frontend/backend run locally and tests pass.

## M2 — Import, inspect, and jobs
- Local file upload.
- Safe file handling and project creation.
- ffprobe metadata.
- Background job state/progress/cancel.
- Source validation and error states.

**Done when:** valid video uploads and metadata is visible.

## M3 — Transcription
- FFmpeg audio extraction.
- faster-whisper transcription with timestamps.
- Transcript viewer and SRT export.
- Model/device settings and missing-model guidance.

**Done when:** test video yields synchronized transcript and SRT.

## M4 — Clip Finder
- Candidate selection using configurable provider.
- Structured output validation.
- Editorial score components and context risk.
- Candidate review, seek, and start/end adjustment.
- Manual fallback if LLM unavailable.

**Done when:** user can review and adjust candidates without relying on fake data.

## M5 — Render and captions
- Vertical render.
- Caption presets and burn-in.
- Preview render and final export.
- Export listing and open-folder action.

**Done when:** MP4 plays and caption timing/position are validated.

## M6 — Music Studio
- Import local audio.
- Metadata/license fields.
- Preview track.
- Gain, fades, loop/trim, speech ducking.
- Safe mix render.

**Done when:** music can be mixed and dialogue remains intelligible.

## M7 — AI Creative Studio & Creator Publishing Suite
- Context-aware assistant grounded in transcript or raw input.
- Hook, title, caption, hashtag, CTA, and pinned comment generator.
- **Threads Writer**: multi-post thread drafting with character counter and formatting controls.
- **Raw Ideas to Content**: raw voice/text notes to structured video concepts and outlines.
- **Content Repurposing Engine**: one-click transformation from clip to Threads series, carousel outlines, and newsletter summary.
- **Content Strategy & Monetization Planner**: niche pillars, monetization pathway checklist, and compliance criteria.
- **Content Calendar**: visual schedule planner with status pipeline (Idea -> Draft -> Scheduled -> Published).
- Ideas & Copy Library with tagging, search, and SQLite persistence.
- Provider disclosure, consent modal, and deterministic local/manual fallback.

**Done when:** copy is grounded in source transcript, multi-post threads and repurposed formats generate cleanly, and calendar/ideas persist in SQLite.

## M8 — Lightweight editor
- Timeline with video/speech/music/caption tracks.
- Trim/split/seek.
- Caption and audio inspector.
- Undo/redo where feasible.
- Autosave and edit manifest.

**Done when:** basic edits can be made without external editor.

## M9 — Advanced local features
- Auto-reframe/face detection.
- Improved word-level captions.
- Silence suggestions.
- Beat-aware suggestions.
- Local music-generation experiment only after hardware/license review.
- Trend reference panel only with permitted and date-stamped data.

**Done when:** each feature has tests and documented resource requirements.

## M10 — Polish and reliability
- Accessibility review.
- Failure and cancellation testing.
- Disk-space handling.
- Concurrency limits.
- Dependency/license audit.
- Backup/export behavior.
- Performance testing on target laptop.

## Scope control
If a feature would delay a milestone without proving the core workflow, put it in a later milestone. Do not remove it from the roadmap without an explicit decision-log entry.
