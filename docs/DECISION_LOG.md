# Decision Log

Use this file to record durable decisions. New entries should include date, decision, rationale, consequences, and status. Do not silently reverse an accepted decision.

## D-001 — Local-first application
**Status:** Accepted  
**Decision:** Start as a local app accessed via localhost.  
**Rationale:** Minimize ongoing costs and keep media private.  
**Consequence:** Initial setup requires installing dependencies/models; public hosting is out of scope.

## D-002 — No mandatory paid API
**Status:** Accepted  
**Decision:** Core workflow must function without paid API. Optional cloud providers can be configured separately.  
**Rationale:** User has Gemini Pro but no other paid subscriptions and wants to avoid additional recurring cost.  
**Consequence:** Local model quality/performance must be evaluated; Gemini API must not be assumed included in Gemini Pro.

## D-003 — Personal clipping workflow first
**Status:** Accepted  
**Decision:** Optimize for the user's personal content production workflow before SaaS.  
**Rationale:** User wants to become a clipper and publish personal channel content.  
**Consequence:** No accounts, billing, multi-user tenancy, or public service in MVP.

## D-004 — AI assistant is a core module
**Status:** Accepted  
**Decision:** Include a dedicated Creative Assistant and persistent Ideas & Copy Library.  
**Rationale:** User wants brainstorming, titles, captions, hooks, and other publishing references inside the website.  
**Consequence:** The assistant must be context-aware, editable, saveable, and privacy-aware.

## D-005 — Music approach
**Status:** Accepted  
**Decision:** Start with licensed/user-provided local audio and automatic matching/mixing. Local AI music generation is advanced/experimental.  
**Rationale:** Reliable, free, legal usage is more important than pretending access to every trending track.  
**Consequence:** Trending music is not downloaded automatically; verified trend references require a permitted data source.

## D-006 — Reference Threads post not yet reviewed
**Status:** Pending input  
**Decision:** Do not incorporate unspecified features from the linked Threads post until its actual content is accessible.  
**Rationale:** Direct fetch returned HTTP 429 and search did not reveal the post's contents. Guessing would risk scope drift.  
**Needed:** User should provide screenshots or paste the post text (including carousel slides if any). Then assess each feature as Must-have / Useful later / Out of scope.

## D-007 — Expansion of Creator Content Suite
**Status:** Accepted  
**Decision:** Explicitly integrate five expanded creator features into product specifications, architecture, and roadmap:
1. Threads Writer (multi-post thread composer, character counting, hooks, call-to-action).
2. Raw Ideas to Content (brainstorming from messy thoughts/notes into structured content pillars and video concepts).
3. Content Repurposing Engine (systematic translation of 1 video/clip into text threads, carousel slides, short scripts, and newsletter blurbs).
4. Content Strategy and Monetization Planner (defining creator niche pillars, monetization pathways, and transparent compliance criteria without fake viral guarantees).
5. Content Calendar (visual scheduling, publishing status pipeline: Idea -> Draft -> In Review -> Scheduled -> Published).  
**Rationale:** Creators need an end-to-end publishing pipeline alongside video editing to turn video clips into a coherent multi-platform distribution strategy.  
**Consequence:** Data models (`Idea`, `CalendarItem`, `ContentStrategy`) and API routes expand; features will be phased cleanly in the roadmap without blocking P0 core clipping.

## D-008 — FFmpeg and Environment Handling
**Status:** Accepted  
**Decision:** Never attempt silent auto-installation of FFmpeg or system binaries. The application backend will provide a dedicated system diagnostics endpoint (`/api/system/check`) and clear Windows setup guidance (e.g., `winget install Gyan.FFmpeg` or manual PATH setup).  
**Rationale:** Preserve user environment integrity and safety.  
**Consequence:** The app must gracefully display system readiness in the UI topbar/dashboard when FFmpeg or optional AI providers are missing.

## D-009 — Frontend Styling and Design System
**Status:** Accepted  
**Decision:** Use Vanilla CSS / CSS Modules with a unified design token system (`index.css`), adhering to the professional dark-mode workstation aesthetic defined in `UX_UI_SPEC.md`.  
**Rationale:** Maximizes layout control, avoids conflicting CSS framework abstractions, guarantees fast build times, and keeps desktop density high without decorative clutter.  
**Consequence:** Clean, modular CSS stylesheets per component/feature without third-party utility baggage.

