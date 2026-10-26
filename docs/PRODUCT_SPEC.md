# Product Specification

**Status:** Draft / source of truth

## 1. Vision
ClipForge Studio is a local-first creator workstation for turning authorized long-form videos into high-quality short-form clips. It should save repetitive time while preserving editorial control. It is for personal use first, not an immediate SaaS launch.

## 2. Primary user jobs
- Find moments with a strong hook and meaningful payoff.
- Preserve enough context to avoid misleading edits.
- Create readable subtitles and stable vertical framing.
- Add suitable background music without overpowering speech.
- Brainstorm angles, titles, hooks, captions, hashtags, CTAs, and series ideas.
- Maintain consistent visual identity through reusable presets.
- Export ready-to-review media and copy bundles.

## 3. Main navigation

The application interface is structured into three clear workflows:

### A. Video & Media Production
1. **Dashboard** (System health, recent projects, quick actions)
2. **Projects / Import** (Local video ingestion, probe inspection, rights note)
3. **Clip Finder** (Transcript browser, candidate moments, editorial scoring)
4. **Editor** (Lightweight multi-track timeline, trim/split, framing)
5. **Caption Studio** (Subtitles, styling presets, safe-area overlay)
6. **Music Studio** (Local audio library, license metadata, speech ducking)
7. **Exports** (MP4 render queue, SRT, and copy bundles)

### B. AI Creative Studio & Publishing Suite
8. **AI Creative Studio** (Comprehensive studio containing):
   - **Hook, Title, Caption & Hashtag Generator** (Multi-variant short-form copy)
   - **Threads Writer** (Multi-post thread composer, character counting, hooks, CTAs)
   - **Raw Ideas to Content** (Transform messy stream-of-consciousness/notes into structured content pillars & scripts)
   - **Content Repurposing** (1 video/clip -> Threads series, carousel outlines, newsletter summaries)
   - **Content Strategy & Monetization Planner** (Niche pillars, audience persona, monetization pathways, compliance review)
9. **Ideas & Copy Library** (Searchable catalog of saved ideas, hooks, drafts, and series)
10. **Content Calendar** (Visual editorial schedule: Idea -> Draft -> In Review -> Scheduled -> Published)

### C. Workspace & System
11. **Style Presets / Brand Kit** (Caption styles, font defaults, creator tone, handles)
12. **AI Settings & System Check** (Local/optional AI providers, FFmpeg status, storage diagnostics)

Hide or mark as planned any route whose function is not implemented. Do not display fake stats or fake job progress.

## 4. Feature tiers

### P0 — MVP (Core Video Pipeline & Foundation)
- Local video upload and media inspection.
- Background processing jobs with real progress, cancel, and error states.
- Timestamped local transcription (`faster-whisper`).
- Transcript viewer with keyword search.
- AI-assisted candidate clip selection; manual fallback if no LLM is available.
- Candidate score, hook, rationale, transcript excerpt, and context risk.
- Start/end adjustment.
- Vertical 9:16 rendering.
- Subtitle burn-in and SRT export.
- Readable caption presets and safe-area overlays.
- Add local/user-provided audio, volume controls, fade in/out, basic speech ducking.
- Core copy generator: titles, captions, hooks, hashtags, and CTA from selected transcript.
- Export MP4 and text bundle.
- Privacy/provider status and diagnostics.
- Windows setup guide.

### P1 — Core Creator Workstation & Publishing Suite
- Lightweight editor timeline with video, speech audio, music, and caption tracks.
- Trim/split/seek and simple track controls.
- Caption text/timing edit.
- Dynamic emphasis captions and karaoke-style approximation when timing data supports it.
- Auto-reframe with center crop fallback; optional face detection.
- **AI Creative Studio expansion**:
  - **Threads Writer**: multi-post thread drafting with character limits, hook hooks, and concluding CTAs.
  - **Raw Ideas to Content**: unstructured thought-to-content converter with structured angles and script outlines.
  - **Content Repurposing Engine**: one-click conversion of clip transcripts into multi-format assets.
  - **Content Strategy & Monetization Planner**: niche analysis, value ladder, monetization angles (affiliate, brand deals, services).
  - **Content Calendar**: schedule planner with status pipeline (Idea -> Draft -> Scheduled -> Published).
- Ideas & copy library with tagging, status filters, and search.
- Tone and platform presets.
- Brand kit: preferred tone, topics, caption style, font/color choices, handle/CTA defaults.
- Music library catalog with mood, energy, BPM if known, source, license, and attribution.
- Music matching and speech ducking.
- Save style presets.
- Undo/redo where feasible.

### P2 — Advanced / only after validation
- Local AI music generation, subject to performance and license review.
- Beat-aware edit suggestions.
- Improved word-level captions.
- Silence detection and suggested trims.
- Advanced face/speaker-aware reframing.
- Trend reference panel using permitted sources and transparent timestamps.
- Batch rendering with concurrency limits.
- Additional aspect ratios and platform export profiles.
- Optional permitted-source URL adapters.

### Not in MVP
- Guaranteed viral prediction.
- Auto-publishing to social platforms.
- Unlicensed scraping/downloading of trending music or restricted video.
- Public SaaS, user accounts, billing, or cloud GPU processing.
- A full Premiere/DaVinci replacement.
- Voice cloning or impersonation.

## 5. AI clip suitability scoring
Use a transparent 0–5 rubric:
- Hook strength.
- Standalone comprehensibility.
- Payoff/value.
- Narrative/emotional interest.
- Clarity.
- Pacing.
- Context-risk penalty.

Display the component scores and reasoning. Label the result “Editorial potential” or “Clip suitability,” never “probability of going viral.”

## 6. AI Creative Assistant
Assistant modes:
- Brainstorm a niche/channel angle.
- Brainstorm ideas from a selected transcript or topic.
- Find distinct editorial angles.
- Generate opening hooks.
- Generate titles (with different tones).
- Generate captions and CTAs.
- Suggest topic-relevant hashtags without stuffing.
- Suggest pinned comments.
- Build a multi-clip content series from one source.
- Repurpose one clip into other formats (text post, carousel outline, short script) without inventing facts.
- Critique a draft for clarity, hook, context, and audience fit.

Outputs must be editable, copyable, and saveable to the Ideas & Copy Library. The assistant should ask for missing audience/platform context only when necessary. It must label assumptions and avoid unsupported factual claims.

## 7. Copy output schema
Each generated package should include:
- `title_options[]`
- `hook_options[]`
- `caption_options[]`
- `cta_options[]`
- `hashtags[]`
- `pinned_comment_options[]`
- `tone`
- `target_audience_assumption`
- `rationale`
- `source_transcript_range`
- `warnings[]`

## 8. Acceptance criteria
MVP is accepted only when:
- A local file can be imported and inspected.
- Transcription produces timestamped segments.
- Candidate clips are shown and can be adjusted.
- A selected candidate renders into a playable MP4.
- Captions are synchronized and readable.
- User-provided/local music can be mixed while speech remains intelligible.
- Copy can be generated by a configured provider or a clear manual fallback exists.
- All exports can be located from the UI.
- Errors are actionable; unsupported features are not disguised as working.
- Core workflow has no mandatory paid API.
