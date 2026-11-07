# Edit-tool

**قَصّة (Qassa)** — local video editor driven by Claude: drop footage into a project, Claude cuts/grades/titles it through MCP tools, the user sees and adjusts everything live in a web UI. A general AI editing tool: any footage (talking head, screen recordings, camera, shorts), any language — Arabic first-class (RTL, Arabic Whisper), looks themeable per project (`settings.theme`).

**Editing a video?** Use the `edit-tool` skill (`.claude/skills/edit-tool/SKILL.md`) and the `edit-tool` MCP tools. Answer in Arabic.

## Run

```bash
npm run dev        # server :4317 + editor UI :5173 (or preview_start "edit-tool")
npm test           # vitest: ops, render compiler
npm run typecheck
```

First-time setup: `powershell -File setup.ps1` (venv with faster-whisper/scenedetect/opencv + CUDA libs, npm install).

## Map

| Path | What |
|---|---|
| `packages/shared` | zod schema of `project.json`, edit ops (`applyOps`), timeline math, text-layer markup shared by UI and renderer |
| `packages/server` | Fastify API + WebSocket, project store with undo, job queue, analysis/render/style jobs, contact sheets, cut checks, project covers, AI tasks typed in the editor (`agent.ts`: `claude -p` per request, tier from `shared/src/router.ts`, cost log `ai-tasks.jsonl`) |
| `packages/render` | `compile()` project → ffmpeg jobs (cached per-clip segments + final pass), `runPlan()` |
| `packages/mcp` | MCP server (stdio) — Claude's tools; auto-starts the server |
| `packages/app` | React editor UI (Vite) |
| `graphics-lib/` | Shared HTML graphic templates (`lib/<name>` in `clip.graphic`, params in `clip.graphicData`), `_shared/kit.{css,js}` = their common look |
| `sfx-lib/` | Sound effects synthesised by ffmpeg on first use (`packages/server/src/sfx.ts`); copied into a project's `sfx/` when placed on the SFX track; `sfxPlan()` in shared places them automatically |
| `brands/` | Reusable identity kits (`brand.json`, uploaded original, logos and font assets); `settings.brand` selects a kit |
| `styles/` | Styles the user saved (`style.json` + LUT) and `recent.json` (global recent style history) and `favorites.json` (ids hearted in the styles window: library references, looks, saved styles); the built-in library is `STYLE_PRESETS` in `packages/shared/src/styles.ts` |
| `brand/` | The قَصّة marks; the identity (tokens, voice, components) is the design system linked in `brand/README.md` — follow it for any UI change |
| `analysis/` | Python: `analyze.py` (proxy, peaks, thumbs, Whisper words, silences, retakes, shots, summary), `style.py` (reference → STYLE.md + LUT) |
| `docs/` | `IMPROVEMENTS.md` (what was built, newest at the bottom), `api/` (checkpoints, export preflight, project management), `research/`, `history/` (past plans and validation notes) |
| `scripts/` | `sync-style-library.mjs` (`npm run styles:sync`), `check-export-snapshot.mjs` / `check-project-mcp.mjs` (isolated end-to-end checks: real export, MCP smoke) |
| `projects/<name>/` | `project.json` (source of truth), `source/ refs/ analysis/ graphics/ luts/ cache/ renders/`, `CHANGES.md` |

## Rules

- All edits go through ops (`packages/shared/src/ops.ts`). A new kind of edit = a new op + a test in `packages/shared/test`.
- Times: `in/out/t0/t1` are source seconds, `start/at` are timeline seconds. V1 is magnetic; other tracks are re-anchored to their content after V1 edits.
- ffmpeg always runs with cwd = project folder and project-relative paths (keeps `D:` out of filtergraphs).
- Python scripts talk to the server with `@@ {json}` lines on stdout; the last one is `{"result": ...}`.
- Text overlays render from `textLayerHtml()` in a headless browser — the editor preview uses the same markup.
- Keyboard shortcuts are defined once in `packages/app/src/lib/keys.ts` (rebindable, physical keys so they work on an Arabic layout); add new ones there, not as ad-hoc key handlers.
- User comments (`project.notes`, ops `add_note/update_note/delete_note`) are pinned to timeline time and re-anchored to their content after V1 edits, like free clips; Claude reads them with the `notes` MCP tool and replies via `update_note`. «نفّذ» on a comment (or `settings.aiNotes` for every new one) starts an AI task on just those comments (`AgentRequest.notes`, tier from `routeNotes`).
- Visual ideas (`project.ideas`, ops `add_ideas/resolve_ideas`, `shared/src/ideas.ts`) are proposed visuals pinned to the source words they go with (like cut suggestions), so they follow cuts without re-anchoring; adding one places it on a free overlay/text track at its words (a `shot` becomes a comment). The editor's «اقترح بي-رول» runs an AI task with `AgentRequest.ideas`.
- HTML graphics (`clip.graphic` → `graphics/<name>/index.html`) are time-driven only: `GRAPHIC_RUNTIME` (`packages/shared/src/graphics.ts`) pauses and seeks the page's CSS/WAAPI animations and GSAP `window.__timelines` (HyperFrames-compatible). The editor iframe and the renderer (`packages/server/src/graphics.ts`, frame-by-frame screenshots → PNG-in-MOV in `cache/graphics/`) both use it.

- When making graphics, read the project’s `settings.brand` kit with `brands` and use its palette, logo, fonts and voice. Log library references with `style_reference {project, id, what}` or the undoable `log_style` op; `apply_style` records its own use.

- Tracks are user-managed via undoable `add_track/set_track/move_track/remove_track` (nonempty removal needs `deleteClips:true`; V1 stays first and cannot be removed). Text goes on text tracks, graphics on overlay tracks; video sound may go on audio tracks. `track.audio` defaults to `music`; `voice` is never ducked or auto-faded and joins V1 as the key that ducks music. `picture.off` hides the picture without moving or shortening the clip. Project starts (`video/podcast/empty`) only choose initial tracks.

- Transcription is opt-in. Import/ordinary analysis never runs Whisper; energy-based silence detection stays available without words. Before requested word-level cuts, retakes, captions or speech-based ideas, tell the user, then explicitly call `analyze` with `steps:["transcribe","silence","summary"]` and wait. Placing media or changing visuals never authorizes transcription. Playback, export, covers and ranges use the last clip on any track (`projectDuration`); absent V1 picture is black.

- In/Out marks live in settings.marks and use undoable set_marks (timeline seconds, null clears, reversed pairs swap). Marks never re-anchor with V1. The playhead line/head and lower ruler scrub with magnet snapping to fixed clip edges/comments, never to the moving playhead itself. In the UI, only dedicated I/O grips in the separate upper lane or rebindable I/O keys adjust export marks; unmarked projects show default start/end grips, and their first drag creates the range; ordinary ruler/empty-track/Alt-band gestures never set a range. N toggles magnet and Alt bypasses it while dragging; one grip drag is one undo. render marked:true exports the saved pair for «صدّر المحدد». delete_range ripple-deletes across all tracks in one op; only do it when deletion is requested, and batch set_marks clearing if appropriate.

- Desktop: EDIT_DATA_DIR holds all writable data (Documents/Qassa by default); EDIT_RESOURCES_DIR holds read-only packaged code, graphics, fonts and catalog. Dev defaults stay in the repo. Bundled MCP rereads <data>/.port and never auto-starts a second desktop server. Analysis/transcription require completed first-run setup; the editor and export do not. Never silently move existing projects.

- Captions generated by captions carry clip.words {mediaId,from,to,clipId?}. Source edits remove absent words and trim/split/re-time their captions in the same undo step, independent of generic V1 anchors. clipId disambiguates repeated source occurrences; operation-local source lineage follows splits/merges. Plain/legacy text without words stays independent; regenerate legacy captions to add links. Export preflight warns about overlaps on caption tracks.
