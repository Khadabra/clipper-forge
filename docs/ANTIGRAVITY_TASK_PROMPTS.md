# Antigravity Task Prompts by Milestone

Use only the prompt for the current milestone. Run `ANTIGRAVITY_MASTER_PROMPT.md` context first.

## M0 — Audit
Read all docs and inspect the repository. Do not change code yet. Report current files, contradictions, prerequisites, dependency choices, Windows-specific risks, and the plan for M1. Confirm the unresolved Threads reference is not to be guessed.

## M1 — Foundation
Implement only the foundation: React + TypeScript + Vite frontend, FastAPI backend, `/api/health`, `/api/system/check`, environment configuration, SQLite connection strategy, logging, test scaffolding, and application shell based on `UX_UI_SPEC.md`. Show unimplemented routes as planned or hide them. Run tests and document exact commands.

## M2 — Import and jobs
Implement local upload, safe storage paths, ffprobe inspection, project metadata, and persistent background job states/progress/cancellation. Add tests for invalid files, unsafe names, and media without audio. Do not implement transcription yet.

## M3 — Transcription
Implement FFmpeg audio extraction and faster-whisper transcription with timestamps. Add transcript viewer and SRT export. Support model-size/device configuration and explain missing dependencies. Test timestamp ordering and SRT formatting.

## M4 — Clip Finder
Implement structured candidate generation through provider adapter, score components, context risk, transcript context preview, filters, and boundary editing. If the provider is unavailable, provide a real manual fallback, not fabricated AI output.

## M5 — Captions and render
Implement vertical preview/final render, caption presets, safe-area guides, MP4/SRT export, and export history. Verify output dimensions, playback, and subtitle synchronization.

## M6 — Music Studio
Implement local audio import/catalog, source/license metadata, preview, gain, fades, loop/trim, and speech ducking. Warn on missing license metadata. Do not fetch trending songs automatically.

## M7 — Creative Assistant
Implement context-aware brainstorming and copy generation for selected clip/transcript/topic: ideas, angles, hooks, titles, captions, hashtags, CTA, pinned comment, content series, and critique. Provide multiple distinct variants, edit/copy/save actions, and Ideas & Copy Library. Disclose external provider use and provide local/manual fallback.

## M8 — Lightweight editor
Implement reliable timeline interactions for video/speech/music/captions, trim/split/seek, audio controls, caption inspector, autosave, and undo/redo where feasible. Prefer a smaller functional editor over a fake complex timeline.

## M9 — Advanced experiments
Evaluate local AI music generation, face-aware reframing, word-level captions, silence suggestions, beat-aware edits, and trend reference data one at a time. Before implementation, document model license, hardware requirements, performance, source reliability, and fallback.

## M10 — Polish
Run accessibility, security, failure, cancellation, performance, and license checks. Test on target Windows laptop and update docs.
