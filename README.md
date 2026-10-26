# ClipForge Studio — Project Documentation

**Version:** 0.2.0-draft  
**Status:** Product blueprint, not implementation confirmation  
**Product:** Local-first AI clipping, short-form editing, and creator workspace  
**Primary use:** Personal clipping channel; potential income through publishing and later expansion.

## Product summary
ClipForge Studio turns authorized video sources into reviewed short-form clips. It combines transcription, candidate selection, vertical reframing, captions, music mixing, a lightweight editor, and an AI Creative Assistant for brainstorming and publishing copy.

**Core workflow:** Import → Transcribe → Find moments → Review → Edit → Add captions/music → Generate copy → Export.

## Source of truth
Read these files before coding:
- `docs/PRODUCT_SPEC.md`
- `docs/UX_UI_SPEC.md`
- `docs/TECHNICAL_ARCHITECTURE.md`
- `docs/AI_BEHAVIOR_SPEC.md`
- `docs/CONTENT_RIGHTS_AND_MUSIC.md`
- `docs/ROADMAP.md`
- `docs/TEST_PLAN.md`
- `docs/DECISION_LOG.md`
- `docs/REFERENCE_LINK_REVIEW.md`
- `docs/ANTIGRAVITY_MASTER_PROMPT.md`
- `docs/ANTIGRAVITY_TASK_PROMPTS.md`

If instructions conflict, prioritize safety/privacy, then the latest explicitly accepted decision in `DECISION_LOG.md`, then the product and technical specs. Do not silently delete requirements; propose changes first.

## Non-negotiables
1. No paid API is mandatory for the core workflow.
2. Run locally on the user's Windows laptop first; no public hosting or subscription system in MVP.
3. Do not claim a feature works until it is implemented and tested.
4. Do not claim a clip will go viral. Scores are editorial suitability estimates only.
5. Do not bypass DRM, login walls, paywalls, or platform restrictions.
6. Local upload is the primary source path. Online sources must be accessible and authorized for the intended processing.
7. Do not download or bundle unauthorized trending songs. Store license/source metadata for audio assets.
8. Disclose any external AI provider use before sending content outside the device.
9. Keep provider adapters replaceable.
10. Build incrementally, one milestone at a time.

## Initial stack
- Frontend: React + TypeScript + Vite.
- Backend: Python + FastAPI + Pydantic.
- Database: SQLite.
- Media: FFmpeg / ffprobe.
- Transcription: faster-whisper.
- Local LLM: optional Ollama adapter.
- Optional external text model: Gemini API adapter, off by default; Gemini Pro subscription does not automatically imply unlimited API usage.
- Tests: pytest and Vitest/React Testing Library.
- Styling: choose Tailwind OR CSS Modules during foundation setup, not both.

## Development rules
Open the project root in Antigravity. First ask the agent to read this README and all docs. It must report the current milestone and constraints, then implement only that milestone. After each milestone, run tests and update the decision log if a decision changed.

The linked Threads reference is not yet analyzed: see `docs/REFERENCE_LINK_REVIEW.md`. Do not invent features from that post or implement them until the user provides accessible text/screenshots or the post can be reviewed.
