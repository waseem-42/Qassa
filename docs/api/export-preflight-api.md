# Export readiness and queued snapshot contract

All `:name` values identify the stable project folder, never `project.name` (the editable display name).

## GET `/api/projects/:name/render/preflight?quality=final|preview`

Default quality is `final`. Returns `{ ready, rev, snapshotId, quality, blockers, warnings, resources }`.

- `rev`: current in-process Store revision, suitable for the optional optimistic guard below. Revisions reset when a project is loaded in a fresh server; `snapshotId` is a SHA-256 of the captured Project JSON and remains identifiable across a restart.
- `blockers` and `warnings`: arrays of `{ code, message, clipId?, mediaId?, path? }`. Missing effective media inputs, graphic entry pages or effective LUTs, invalid clip references/ranges and an empty main track block export. Preview may use a valid proxy if the original is missing (warning); final requires the original. Unreviewed suggestions, open notes, missing optional proxies, unknown custom fonts or missing browser/font support warn. Missing/malformed optional transcript analysis makes cut checking unavailable (warning), not a failed render request. Warnings do not block submission.
- `resources`: array of `{ kind: 'media'|'proxy'|'graphic'|'lut'|'font'|'browser', path, status: 'ready'|'missing'|'unverified', mediaId?, clipId? }`. Files are checked only for the captured edit, plus render text/font support when needed; unused imported files do not block. A missing preview proxy falls back to the original source. HTML entry-page existence does not validate every asset, runtime script, font glyph or external URL inside the page.
- `ready` means `blockers.length === 0`; it is a static readiness check, not successful rendering or visual approval.

## POST `/api/projects/:name/render`

Body `{ quality?: 'preview'|'final', output?: string, expectedRev?: number }`. Existing POST quality default remains `preview` for compatibility. Invalid body/output returns 400. `expectedRev`, when provided, is a nonnegative integer; mismatch returns 409 `{ error, code: 'stale_revision', rev }` and creates no job. A failed preflight returns 409 `{ error, code: 'export_not_ready', preflight }` and creates no job.

Before `jobs.add`, the handler synchronously captures a deep clone of Project and its revision. The queued runner exclusively uses that captured Project. Metadata `{ rev, snapshotId, quality, output }` is returned as `render` beside the existing `{ job }`, is attached to `job.render` before its initial WebSocket event, and is included in the completed job `result`. The optional `job.render` field is additive; existing jobs remain compatible. Queued edits never substitute the latest Store state.

Default output is unique per request: `renders/<quality>-r<rev>-<uuid>.mp4`. Explicit output is a safe project-relative `.mp4/.mov/.mkv` path under `renders/`; traversal, absolute paths, Windows devices/streams, links/junctions, existing files and active jobs reserving the same explicit output are rejected (400 for invalid paths, 409 for collisions). Paths remain based on the folder ID after display-name changes.

Only Project data is frozen. Media bytes, HTML graphics, fonts, LUTs and other disk/network dependencies are not copied. They must remain available and unchanged while queued/running. Missing dependencies are checked at submission; later external changes can still fail or alter a render. Preflight does not claim to validate HTML dependencies or installed custom-font coverage. Job metadata/results are currently held in the existing in-memory job queue; this change does not add a persistent export history or automatic recovery after a server restart.
