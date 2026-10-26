# UX / UI Design Specification

**Status:** Draft design source of truth  
**Direction:** Focused editorial workstation, not generic AI dashboard.

## 1. Art direction
- Professional, restrained, high-information-density desktop tool.
- Dark neutral default theme with one controlled accent color selected during a small prototype.
- Strong typography, clear spacing, aligned panels, tabular numerals for timecodes.
- Avoid excessive gradients, glassmorphism, glowing AI cards, random charts, emoji icons, and decorative clutter.
- Preview should be the focal point in editing contexts.
- Color indicates selection, state, risk, or action—not decoration.
- Use consistent icon library and accessible contrast.
- Support laptop-sized screens; avoid requiring a giant monitor.

## 2. App shell
- Left sidebar grouped into clear functional zones:
  - **Media & Editing:** Dashboard, Projects / Import, Clip Finder, Editor, Caption Studio, Music Studio, Exports.
  - **AI Studio & Publishing:** AI Creative Studio (Hooks/Titles/Captions, Threads Writer, Raw Ideas, Repurposing, Strategy), Ideas & Copy Library, Content Calendar.
  - **Workspace & System:** Style Presets / Brand Kit, AI Settings / System Check.
- Top bar: project name, active job progress badge, system diagnostics status (FFmpeg / AI Provider), quick save indicator.
- Main workspace with consistent panel rhythm.
- Job notifications remain visible without blocking work.
- Features not yet built must be marked “Planned” or hidden behind a feature flag.

## 3. Dashboard
- Main CTA: New Project.
- Recent projects with thumbnail, source duration, date, and real status.
- Current job progress with cancel action.
- Compact system health: FFmpeg, transcription model, optional LLM provider, available disk.
- Empty state teaches the first workflow.
- No fake analytics or fabricated counts.

## 4. Import
- Drag/drop plus file picker.
- Optional authorized source URL input, but local upload is primary.
- Show media validation, duration, resolution, frame rate, audio streams, file size.
- Settings: language, aspect ratio, target clip duration, number of candidates, content category.
- Rights/access note and external-provider disclosure.
- Advanced settings collapsed by default.

## 5. Clip Finder
- Left: searchable transcript with timestamps and surrounding context.
- Right: candidate list with preview, duration, editorial score, rationale, topic, context risk.
- Filters by duration, score, topic, status.
- Accept/reject, adjust boundaries, open in editor.
- Clicking transcript seeks preview.
- Show before/after context to reduce misleading edits.
- Never call score “viral probability.”

## 6. Editor
- Center: video preview with safe-area toggle.
- Bottom: lightweight timeline for video, original speech, music, captions.
- Side inspector tabs: Clip, Framing, Captions, Audio, Export.
- Basic controls: play/pause, seek, trim handles, split, track mute/solo, gain, fade.
- Autosave project edits and provide clear saved/unsaved status.
- Undo/redo where feasible.
- Do not fake timeline drag interactions if not implemented; start with reliable trim fields and seek controls if needed.

## 7. Caption Studio
- Preview with safe-area guides.
- Segment list with text and timing.
- Style presets with small previews.
- Controls for font size, weight, text/background color, outline, position, words per line.
- Distinguish normal segment captions from true word-timed karaoke.
- Keep subtitles readable and away from platform UI zones.

## 8. Music Studio
- Local library with search, mood, energy, tags, duration, BPM if known.
- Display source and license/attribution metadata.
- Preview track, set in/out, gain, fades, speech ducking.
- AI recommendation explains why a track matches the clip.
- Separate “mood match” from “trend reference”; never claim a track is trending without dated evidence.
- Warn if license metadata is missing.

## 9. AI Creative Assistant
- Chat/workbench layout, not a novelty floating bubble only.
- Context selector: current project, selected clip, transcript, custom topic.
- Quick actions: Brainstorm, Hooks, Titles, Captions, Hashtags, CTA, Pinned Comment, Content Series, Critique Draft.
- Results as editable variant cards with copy/save/regenerate controls.
- Allow tone/audience/platform/context controls.
- Show which transcript range informed suggestions when available.
- Keep a visible reminder that generated copy needs review.

## 10. Ideas & Copy Library
- Save ideas, generated copy, content series, and reusable prompts.
- Search and filter by topic, status, platform, tone, date.
- Support draft/selected/published states, but do not imply publication occurred automatically.

## 11. Presets / Brand Kit
- Caption presets, export profiles, preferred tone, recurring CTA, creator handle, topics to focus on/avoid.
- Do not force a brand kit before the first project.
- User can preview before applying a preset.

## 12. Exports
- List output video, SRT, copy bundle, duration, dimensions, render date, status.
- Preview, open folder, copy copywriting, reveal errors.
- Provide a clean file naming convention and avoid overwriting silently.

## 13. Settings / System Check
- Show installed dependencies and versions where practical.
- Choose local model size/device.
- Optional external provider toggles default off.
- Explain what data leaves the device before enabling cloud providers.
- Configure storage/temp directories and cleanup.
- Display disk-space warning.

## 14. Responsive and accessibility
- Desktop-first, but usable on narrower laptop windows.
- Keyboard focus, form labels, tooltips, non-color-only status cues, sufficient contrast.
- Loading, empty, error, success, and disabled states for every major workflow.
- Avoid modal stacks; use inspector panels and clear navigation.
