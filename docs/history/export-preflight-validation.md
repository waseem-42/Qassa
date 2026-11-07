# Export preflight implementation validation — 2026-10-29

Implemented in `packages/server/src/export-preflight.ts`, registered by the render section of `packages/server/src/index.ts`. The narrow `Jobs.add` extension accepts optional render metadata before publishing the first event; existing callers are unchanged. No app component was modified by this room.

Verified:

- `npm run typecheck`: passed after the implementation and metadata changes.
- `npm test -- packages/server/test/export-preflight.test.ts packages/server/test/project-management.test.ts`: 26 passed (14 export, 12 project-management) before adding the final malformed-transcript case.
- `npm test -- packages/server/test/export-preflight.test.ts`: final 15 export tests passed, including malformed optional transcript JSON.
- Initial sandbox test launch was blocked by Vite `realpath` EPERM. The authorized run outside the sandbox executed the tests successfully. No installation or permission-setting changes were made.

The real export regression creates a two-second 64×64 H.264/AAC fixture in a guarded temporary workspace, holds the existing Jobs queue, submits a final render, trims the live edit to 0.5 seconds, then releases the queue. `runPlan(compile(capturedProject))` completes and ffprobe reports approximately two seconds and 64×64; result revision/hash identify the queued snapshot. The HTTP and queue integration are real; this test supplies a direct CPU compiler runner instead of the index route's text/HTML preparation, because the fixture contains no overlays. It is not a visual-quality or all-formats claim.

Other tests cover missing/unused media, missing effective LUT and graphic entry, library paths and junction escape, unknown tracks/media, hidden/muted/out-of-range unused layers, original/proxy fallback, nonblocking fonts/browser/notes/suggestions, stale revision rejection, deep queue isolation, first-event render metadata, unique default outputs, path/device/stream rejection, existing/reserved destinations, cancellation release, and an output file appearing while queued.

The adjacent silent-source issue encountered during the initial fixture has now been fixed in the separately authorized compiler follow-up. Local FFmpeg 8.1.2's `loudnorm` short-input path produced nonfinite samples for two seconds of digital silence, including a present but silent audio stream; both final and preview failed. The compiler now pads only the internal normalization input to a minimum of three seconds with `apad=whole_dur=3`. The existing final duration limit removes the analysis padding from the delivered video. No artificial noise is added, and normalization remains active for real audio/music. See [silent-source-render-validation.md](./silent-source-render-validation.md) for reproducible diagnosis, scope and actual output checks.

After this fix, `npm test -- packages/render/test/silent-audio.test.ts packages/render/test/compile.test.ts packages/server/test/export-preflight.test.ts` passed all 36 tests: 5 actual silent/audio renders, 16 compiler tests and 15 preflight/queue tests. This supersedes the earlier unresolved warning; the export-snapshot test still uses audible audio to keep its independent assertion focused.

Limits: Project JSON is cloned; disk bytes and network/HTML dependencies are not frozen. Preflight checks entry-file readability, not codec decodability or graphic dependency completeness. Jobs/results remain in memory. An external process can still mutate an input after readiness checks. Safe output checks run at request time and immediately before the queued runner starts; no cross-process reservation protocol is introduced.
