# Test Plan

## Backend unit tests
- Path containment and upload validation.
- Media metadata schema validation.
- Job state transitions.
- Job cancellation.
- Transcript segment timestamp ordering.
- Clip candidate timestamps within source duration.
- Clip score aggregation and context-risk penalty.
- SRT timing and escaping.
- FFmpeg argument construction using arrays.
- Audio mix duration, gain, and fade configuration.
- Provider-offline fallback.
- External provider disabled by default.
- Copy output schema and transcript grounding metadata.

## Integration tests
- Upload a small test video.
- Probe media metadata.
- Transcribe a short known sample.
- Generate a candidate or use deterministic manual fallback.
- Render a vertical MP4 with captions.
- Add a local audio track and verify output.
- Export SRT and copy bundle.
- Cancel a running job and confirm cleanup.

## Frontend tests
- Empty/loading/error/success states.
- Project creation and upload validation.
- Job progress polling.
- Candidate selection and boundary editing.
- Caption editing.
- Assistant variant edit/copy/save.
- Music track license warning.
- Export list and failure details.
- Keyboard focus and form labels.

## Manual release checklist
- App launches on Windows from README.
- Missing FFmpeg produces actionable guidance.
- Missing transcription model does not crash the app.
- Missing Ollama/Gemini configuration is explained.
- No paid API is mandatory for the core workflow.
- No mock content is presented as real processing output.
- Audio is not clipping and speech remains audible.
- Captions are readable within safe areas.
- Output video is playable and has expected dimensions.
- Temporary files can be cleaned safely.
- Storage warning appears before disk exhaustion.
- Privacy disclosures are clear.
