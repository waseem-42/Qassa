# Practical editing baseline — 2026-11-16 (Task 26 only)

Recommendation: prioritize export completion/navigation, the native command-length failure, dropping at the playhead, and seeking while zoomed in. Do not implement Task 28's suggested optimistic updates again: they already exist in `packages/app/src/lib/store.ts:371`. Do not assume persistent playback freezes: the measured 30 fps footage played near its source rate. One 296 ms first-load freeze was found and attributed separately below.

No application code, schema, edit operation or renderer was changed. Proposed fixes below are proposals only. No commit, paid Claude request or Whisper invocation was made. All writable server data lived under disposable `artifacts/qa/task26/isolated-*`, using API 4496 / UI 5296. Original projects were never opened by that server; the real case was a copy of تشويقة.

## Method and evidence

- Host: 12th Gen Intel(R) Core(TM) i5-12400F, 12 logical CPUs, 47.8 GiB RAM; Windows 10.0.26300; Node v24.18.0; Chrome/157.0.8103.52. Server detected NVENC. UI measurements use Vite/React development mode, headless Chrome, 1600×1000 unless stated otherwise.
- Light: 60 s, one V1 video, one title, one overlay. Heavy: 600 s, 150 V1 clips, 120 static caption-style clips, 13 b-roll clips, 10 music sections, three library graphics (steps/chapter/callout), V1 plus four free tracks; 297 clips total. A single generated 640×360/30 fps source is reused, with 15 distinct four-second source ranges. This stresses timeline size and compositing, not a directory of 150 unique camera files or 4K decoding. Project/output resolution is 1280×720 at 30 fps.
- Real: copied تشويقة (70 clips, two WAV sources and its graphics/assets), excluding cache/renders. Its audio-backed preview has no decoded video frames; video frame rate is therefore N/A, not zero-performance.
- Each timeline operation has three final trials per fixture: 90 attempts including six deliberate playhead-drop failures. Store changes are observed in the real browser; two animation frames after a change are a **paint opportunity**, not a compositor presentation timestamp. Gesture timings include scripted mouse movement/holds; release-to-paint is reported separately. Known selection/playhead/scroll preconditions are excluded from latency; action counts include the stated selection/navigation path. Cleanup waits for saves before undoing a trial.
- Source JSON, screenshots, JSONL, complete Chrome CPU profiles and DevTools traces are in `artifacts/qa/task26/`. Scripts and exact commands are in its README. Each `measure-*.mjs` runs with one `node --import tsx artifacts/qa/task26/<script>.mjs` command and emits JSON or JSONL. `measure-all.mjs` runs them sequentially; never run two server scripts on the same ports concurrently.
- Initial harness failures (selectors, a click hitting the playhead, incomplete save waits, and Windows import cleanup) were corrected **in ignored QA scripts only**. Their preliminary incomplete runs are not used as successful operation timings. The animated-text render failure below is a separate valid diagnostic.

## 1. Export and import

Real UI: export → preflight → start → completed job → reveal. First run includes choosing «مراجعة سريعة»; repeats retain the preset. Marked export uses saved [5,10] marks and the dialog's selected-range default; there is currently no separately labelled «صدّر المحدد» header action. Times are wall time from start-click through completed job observation (250 ms polling), not just encoder CPU time.

| Case | Clicks before / after render | Preflight s | Render s | Render s/min output | To reveal acknowledgement s | Result |
|---|---:|---:|---:|---:|---:|---|
| light / cold | 3 / 1 | 0.087 | 9.44 | 9.44 | 9.60 | done; file present, reveal HTTP 200 |
| light / warm | 2 / 1 | 0.056 | 6.44 | 6.44 | 6.52 | done; file present, reveal HTTP 200 |
| light / marked (5 s) | 2 / 1 | 0.056 | 3.19 | 38.25 | 3.27 | done; file present, reveal HTTP 200 |
| heavy / cold | 3 / 1 | 0.675 | 119.78 | 11.98 | 121.13 | done; file present, reveal HTTP 200 |
| heavy / warm | 2 / 1 | 0.746 | 102.08 | 10.21 | 102.86 | done; file present, reveal HTTP 200 |
| heavy / marked (5 s) | 2 / 1 | 0.957 | 33.63 | 403.57 | 34.75 | done; file present, reveal HTTP 200 |

The dialog stayed open, so completion needs one click to reveal. If the user closes it to work, the code-derived path adds closing the dialog and reopening Jobs/Export before Reveal (five clicks overall, two after completion); that alternative path was not timed as a separate trial. The primary table ends at endpoint acknowledgement, not visible Explorer readiness. A separate native observation below completes the visible-folder check.

Heavy cold: graphics 21.01 s, segment pass 4.92 s, final pass 83.31 s. Warm: graphics 0.008 s, segments 0.045 s, final 100.97 s. All 150 segment references hit cache (15 distinct cached encodes); final compositing/encoding still dominates. Marked heavy still compiles the full timeline and applies range late (`packages/render/src/compile.ts:654`), taking 33.63 s for five output seconds. That rate includes setup and must not be extrapolated linearly to long exports.

Independent ffprobe evidence is in `export-probes.json`: both full cases are H.264/AAC, 1280×720, 30 fps, 1800/18000 video frames and exactly 60/600 s; the light marked file is 150 frames / 5 s. The native-folder supplement independently probes both marked cases at 150 frames / 5 s (`folder-results.json`). Future export-script runs probe every file directly before cleanup.

Native Explorer verification used fresh cold [5,10] exports on both fixtures and the real Reveal action. Computer Use screenshots/accessibility showed the matching temporary-folder breadcrumbs, output filename and “1 item selected” for each, before deleting data. Its observation timestamps include tool/controller scheduling, so these are **upper bounds**, not precise shell startup latency:

| Native folder case | Total clicks (open/preset/start/reveal) | Render s (cold marked) | Export click → observed selected file s, upper bound | Reveal → observation s, upper bound |
|---|---:|---:|---:|---:|
| light | 4 | 6.27 | 23.62 | 16.74 |
| heavy | 4 | 69.04 | 80.42 | 9.32 |

Evidence: `folder-results.json`, `folder-light-observed.json`, `folder-heavy-observed.json`, and `*-native-folder-export.png`. Native window screenshots were inspected through the computer-use tool; only target-file observation excerpts were persisted. Both new Explorer windows were closed afterward; the two pre-existing Explorer windows were preserved. The native-observation companion waits for explicit observation acknowledgement and is documented separately from the fully automatic measurement scripts.

Library-import supplement (file picker selection supplied by automation; OS-dialog time and background analysis completion excluded):

| Case | Import clicks | Registration s | Clips immediately after registration | Extra placement clicks / s |
|---|---:|---:|---:|---:|
| Fresh light project | 2 | 0.584 | 0 | 1 / 0.112 |
| heavy | 2 | 0.503 | 297 | 1 / 0.195 |

Importing through the library registers media, then + places it; it does not complete the edit by itself. Direct track drops remain an available route. Ordinary analysis did not request transcription. Import jobs were cancelled/drained before temporary-root cleanup.

## 2. Timeline operations

Numbers are medians of three successful trials. Paint and release columns are ms, written Light / Heavy; RTT is request dispatch → HTTP response headers, also Light / Heavy. An optimistic store update can precede dispatch (small negative raw request-to-store deltas), so it is not a network round-trip measurement. Full per-event request → store → paint timestamps remain in `editor-results.json`.

| Operation | Clicks / keys | Input → paint ms L/H | Release/commit → paint ms L/H | RTT ms L/H | What gets in the way |
|---|---|---:|---:|---:|---|
| Split at known playhead (S) | 0 / 1 | 8.4 / 16.6 | 8.4 / 16.6 | 19.0 / 31.1 | No selection needed; selected clips elsewhere do not prevent fallback to V1. |
| Delete one existing V1 section | 1 / 1 | 14.4 / 21.4 | 14.4 / 21.4 | 23.8 / 29.8 | Magnet on; selection clears because the selected section is removed. |
| Reorder V1 clip | 1 drag / 0 | 75.8 / 85.4 | 9.9 / 16.6 | 24.6 / 31.8 | Light precondition splits the single source first; insertion targets a boundary, not arbitrary time. |
| Move overlay V2 → V3 | 1 drag / 0 | 77.0 / 81.7 | 11.8 / 13.5 | 20.5 / 24.3 | Can scroll the vertical timeline near its lower edge. |
| Trim right edge | 1 drag / 0 | 75.3 / 82.5 | 9.8 / 17.0 | 21.1 / 28.0 | Source in/out constraints and snapping apply. |
| Trim before playhead (Q) | 1 / 1 | 11.3 / 19.0 | 11.3 / 19.0 | 23.8 / 30.1 | Known playhead inside selected clip; no-op at a boundary is excluded. |
| Add default title (T) | 0 / 1 | 11.9 / 16.9 | 11.9 / 16.9 | 23.6 / 23.2 | Creates and selects text; entering custom words is additional typing. |
| Library clip → overlay at 16 s | 1 drag / 0 | 187.5 / 201.3 | 11.0 / 14.0 | 21.5 / 22.6 | 150 ms scripted drag hold is included in gesture latency; see release latency. |
| Change volume | 4 cold, 2 warm / 0 | 15.6 / 25.5 | 15.6 / 25.5 | 21.2 / 28.0 | Select clip → properties → audio → slider; remembered audio tab shortens subsequent visits. |
| Mute V1 | 1 / 0 | 9.6 / 11.8 | 9.0 / 10.7 | 22.0 / 27.2 | Track-head label is «كتم». |
| Undo then redo | 0 / 2 chords | 19.2 / 23.5 | 18.9 / 23.1 | 17.5 / 22.4 | Latency below is first undo feedback, not total two-command duration. |
| Select two sections and delete | 2 / Shift + Delete | 12.1 / 33.2 | 12.1 / 33.2 | 19.3 / 34.6 | Selection setup excluded from latency; both removed, V1 ripples. |
| Zoom in then out | 0 / 2 | 7.6 / 9.5 | 7.6 / 9.5 | — / — | Latency below is first zoom feedback. |
| Jump to 0:45 / 8:30 | 1 / 5 keys | 27.0 / 29.0 | 7.2 / 7.4 | — / — | Four time characters and Enter; viewport behavior tested separately below. |

Arbitrary ripple range deletion was measured separately: I at known 5 s, O at known 10 s, clear selection, Delete. First use adds one confirmation click. Light first use 0.291 s; repeat median 0.044 s. Heavy median 0.198 s. These include server confirmation, unlike the optimistic paint column above. Result durations were 55 and 595 s; marks cleared in the same undo batch. Navigation to endpoints is additional, not counted as free work.

Surprises confirmed in final trials:

- Dropping library media exactly on the playhead at 15 s produced **no request, no new clip and no refusal message in 3/3 trials on each fixture**. The same drag at 16 s succeeded 3/3 on both. `Timeline.tsx:465` requires the hit element to have a track-row ancestor; `Timeline.tsx:851` makes the spanning playhead pointer-interactive. Drop events retained the correct media MIME type. Fresh off-playhead drops also succeeded in `placement-results.json`; this is not missing drag data.
- At zoom 40 px/s, the clock correctly jumps to 45 / 510 s but leaves the playhead off-screen (x=1946 / 20546). Shift+Z fits it back into view. At default fit zoom the same operation works visibly. Evidence: `navigation-results.json`, `*-seek-offscreen.png`; paused seek does not trigger the playing-only scroll subscription at `Timeline.tsx:287`.
- Reordering inside a long V1 clip can leave the order unchanged and display the existing magnetic-track explanation (`Timeline.tsx:456`). Targeting the actual insertion boundary succeeds. This refusal is explained, not silent.
- Selecting a clip through the playhead's narrow hit strip scrubs instead of selecting. Tests select an unobstructed point. Free-track drags near the bottom can scroll V1 under the sticky ruler; later clicks must reveal it first.
- Selection survives successful volume/mute/trim changes in the final trials; it clears after deleting selected clips. No wrong clip move or unconnected selection loss was established. Do not turn early harness races into product bugs.

## 3. Speed and freezes

Main-window rAF callbacks are **not video fps** (this headless setup runs near 200 callbacks/s). Video fps below counts requestVideoFrameCallback on the source videos, including limited preloading; scrubbing counts delivered frame callbacks during seek requests, not continuous playback quality. Decoder droppedVideoFrames was zero in all recorded phases. Gap counts are UI rAF gaps over 33.4 ms, not decoder-drop counts.

| Case / phase | Seconds or elapsed s | Main rAF/s | Video callbacks/s | Max UI gap ms / count >33.4 ms | What gets in the way |
|---|---:|---:|---:|---|---|
| light / open-cold-dev-server | 1.871 | — | — | — | Light first navigation pays Vite/module/browser startup; later projects reuse server/module caches. |
| light / open-browser-warm | 0.408 | — | — | — | Light first navigation pays Vite/module/browser startup; later projects reuse server/module caches. |
| light / play | 6.070 | 197.0 | 29.5 | 39.9 / 1 | 6 s sample from start, crosses a heavy V1 cut; does not cover every late graphic. |
| light / scrub | 0.676 | 192.3 | 7.4 | 20.0 / 0 | Fast seek events are coalesced; source display is less frequent than input. |
| light / drag | 0.481 | 178.8 | 2.1 | 39.9 / 1 | Paused clip drag; video decoding is not the UI frame-rate metric. |
| heavy / open-cold-dev-server | 0.523 | — | — | — | Light first navigation pays Vite/module/browser startup; later projects reuse server/module caches. |
| heavy / open-browser-warm | 0.314 | — | — | — | Light first navigation pays Vite/module/browser startup; later projects reuse server/module caches. |
| heavy / play | 6.040 | 197.8 | 29.8 | 70.0 / 1 | 6 s sample from start, crosses a heavy V1 cut; does not cover every late graphic. |
| heavy / scrub | 1.309 | 98.5 | 11.5 | 30.0 / 0 | Fast seek events are coalesced; source display is less frequent than input. |
| heavy / drag | 0.454 | 189.5 | 2.2 | 20.0 / 0 | Paused clip drag; video decoding is not the UI frame-rate metric. |
| real / open-cold-dev-server | 0.616 | — | — | — | Light first navigation pays Vite/module/browser startup; later projects reuse server/module caches. |
| real / open-browser-warm | 0.337 | — | — | — | Light first navigation pays Vite/module/browser startup; later projects reuse server/module caches. |
| real / play | 6.030 | 198.8 | N/A (WAV + graphics) | 35.0 / 1 | 6 s sample from start, crosses a heavy V1 cut; does not cover every late graphic. |
| real / scrub | 0.991 | 129.1 | N/A (WAV + graphics) | 20.1 / 0 | Fast seek events are coalesced; source display is less frequent than input. |
| real / drag | 0.457 | 190.5 | N/A (WAV + graphics) | 15.0 / 0 | Paused clip drag; video decoding is not the UI frame-rate metric. |

No >200 ms long task occurred after loading during the recorded playback/scrub/drag/operation windows. A separate from-navigation capture **did** find a 296 ms first-load task in Light: `light-startup-trace.json` and `light-startup.cpuprofile`. CPU samples within that exact trace interval attributed about 189.6 ms to **GradeRenderer construction / WebGL initialization** (`packages/app/src/lib/glgrade.ts:135`, mounted by `Viewer.tsx:121`) and 63.7 ms to **Timeline.update** (`Timeline.tsx:241`); its nested Layout event took 55.7 ms. Samples indicate attribution, not exact exclusive wall times. Heavy/real startup maxima were 113/136 ms. `freeze-analysis.json` retains the interval and functions.

Startup profiling adds overhead: its separate cold Light open was 2.090 s versus 1.871 s in the primary script. Do not label the entire project-open wait a CPU freeze. CPU profiles and traces cover both fixtures and the real copy, including startup; no claim is made about an unobserved late scene, physical mouse feel, production/Electron mode or 4K media.

## 4. Working with Claude

No new paid agent run. Existing history: 13 JSONL records in 4 real project files; SHA-256s and line numbers retained in `ai-history-results.json`. Kind is inferred with keyword rules; “other” is deliberately broad. Different tiers did different work, so their costs/durations are not a controlled model comparison. One deep/other record is a 97 ms failed request; its recorded cost is zero.

| Historical request kind / tier | n | Median / max s | Cost total / mean USD | Tokens totals: input / output / cache-write / cache-read | What gets in the way |
|---|---:|---:|---:|---|---|
| graphics-style / deep | 2 | 386.17 / 505.51 | 4.5523 / 2.2762 | 100 / 74748 / 249221 / 5314071 | Observed workload differs across rows; no causal tier-savings claim. |
| cut / deep | 1 | 330.42 / 330.42 | 2.0577 / 2.0577 | 36 / 32716 / 133443 / 1677091 | Observed workload differs across rows; no causal tier-savings claim. |
| other / deep | 4 | 81.39 / 450.44 | 3.9666 / 0.9917 | 86 / 61049 / 250461 / 3702325 | 1 failure included; small sample. |
| other / standard | 3 | 11.39 / 12.13 | 0.5408 / 0.1803 | 22 / 1784 / 117007 / 543115 | Observed workload differs across rows; no causal tier-savings claim. |
| other / quick | 3 | 17.55 / 37.37 | 0.0462 / 0.0154 | 44 / 9428 / 138447 / 1319491 | Observed workload differs across rows; no causal tier-savings claim. |

Standard brief through actual MCP stdio on Light: read summary → edit two known silence ranges → edit title → captions → preflight → render. Six tool calls, plus one untimed discovery list. It used a **labelled synthetic transcript and silence fixture**, not measured Whisper or model reasoning; the silence ranges were supplied by the test, so the summary's lack of transcript segments was not an end-to-end speech-analysis test. Light became 55 s, with one new title and 19 linked captions. Heavy was not given a second standard AI brief; the order requests that brief on Light only.

| Light MCP run | Calls | Total s | Render tool s | Other call/control overhead s | Undo all changes |
|---|---:|---:|---:|---:|---|
| Cold | 6 | 12.423 | 12.049 | 0.375 | 3 header clicks / 0.301 s |
| Warm 1 | 6 | 8.820 | 8.608 | 0.212 | 3 header clicks / 0.340 s |
| Warm 2 | 6 | 9.240 | 8.976 | 0.264 | 3 header clicks / 0.290 s |

Browser-only synthetic running/done cards were used to inspect the existing UI without spending money (`agent-running-simulated.png`, `agent-done-simulated.png`). Running shows a spinner, percentage, elapsed clock, cancel and the current message. **It already reports tool steps**: `server/src/agent.ts:142` emits “خطوة N: tool_name”; Task 30's premise of only a spinner is outdated. Finished cards show reply, model, duration and token/cost summary (`AgentTasks.tsx:131`). They have no structured changed-clip list, seek-to-change action or task-wide undo button. Reading the shown reply needs zero clicks when Assistant is already visible, one rail click otherwise; reviewing individual changes remains manual and was not assigned an invented human review time. Three separate edit batches required three actual undo clicks in every MCP run.

## 5. Visible controls and clutter

Viewport/CSS/ancestor clipping is considered; disabled controls count, fully invisible/opacity-zero hover controls do not. “Visible” does not assert that every control has an unobstructed hit target. Each inspector state was measured separately, not summed as if simultaneously on screen. Both projects have identical counts for their common tabs. Screenshots: `light|heavy-1600|1366-assistant.png`, `*-inspector.png`; complete labelled inventories, disabled state and daily-path flag are in `clutter-results.json`.

| Region / tab | Light 1600×1000 | Heavy 1600×1000 | Light 1366×768 | Heavy 1366×768 | Daily path used |
|---|---:|---:|---:|---:|---|
| Header | 10 | 10 | 11 | 11 | Export, undo/redo; project switch for opening cases. |
| Rail | 6 | 6 | 6 | 6 | Media, Assistant, Properties. |
| Timeline toolbar | 12 | 12 | 12 | 12 | Split/delete/title/zoom; keyboard equivalents also tested. |
| Transport | 10 | 10 | 10 | 10 | Play/pause, clock, start. |
| Assistant | 10 | 10 | 8 | 8 | Existing progress/reply; no paid send clicked. |
| Project / project | 11 | 11 | 9 | 9 | No daily timeline operation requires visiting it. |
| Project / identity | 6 | 6 | 6 | 6 | Not used. |
| Project / SFX | 21 | 21 | 21 | 21 | Not used. |
| Video / picture | 33 | 33 | 21 | 21 | Clip selection opens it; no picture setting needed. |
| Video / audio | 23 | 23 | 23 | 23 | Volume. |
| Video / timing | 16 | 16 | 16 | 16 | Keyboard/edge trimming used instead. |
| Text / text | 16 | 16 | 11 | 11 | Title content editor. |
| Text / timing | 9 | 9 | 9 | 9 | Not used. |
| Graphic / content | N/A | 20 | N/A | 17 | Not used in the daily path. |
| Graphic / place | N/A | 37 | N/A | 27 | Not used in the daily path. |
| Graphic / timing | N/A | 11 | N/A | 11 | Not used. |
| Graphic / identity | N/A | 9 | N/A | 9 | Not used. |

Header + rail + timeline + transport + Assistant total 48 controls at 1600 and 47 at 1366; the laptop adds the guide button while less panel content fits. Graphic placement peaks at 37 visible panel controls. Counts support investigating discoverability; they do **not** measure time to find a button. Automatic daily flags are a broad label match; the table above is the actual operation-level use map.

## Fifteen priorities ranked by session waiting/friction exposure

These are **modelled priorities, not fifteen proven independent defects or measured human time losses**. The unit is one ten-minute-video editing session: one graphics/deep request, one cold and one repeat full export, one marked check, ten cold volume visits, ten library imports, ten far seeks, ten playhead-drop attempts, three completion-return flows and three task undos, three preflight/start cycles, twenty multi-deletes and one cold app load. Interaction overhead is assumed **0.5 s per avoidable action**, not observed. These frequencies are explicit assumptions for Claude to replace with actual user sessions. Parent/child render timings overlap and are marked; do not sum this column. Confirmed broken exports have unbounded completion loss and are in the separate bug list rather than given a fabricated finite recovery time.

| Rank | Point | Exposure s/session | Cause in code | Proposed fix / decision (not implemented) |
|---:|---|---:|---|---|
| 1 | Long deep graphics requests | 386.17 | `packages/server/src/agent.ts:19`, `packages/shared/src/router.ts` | Instrument useful context/turn counts per brief; test smaller scope/tier on the same work before promising cheaper/faster equivalence. History n=2, not a controlled comparison. |
| 2 | Heavy first full export | 119.78 | `packages/server/src/index.ts:495`, `packages/render/src/compile.ts:434` | Profile final compositing first; maintain identical output. Total includes ranks 3/5's related work. |
| 3 | Heavy repeat still runs final pass | 102.08 | `packages/render/src/run.ts:105`, `packages/render/src/compile.ts:667` | Evaluate a completed-output cache keyed by the full export snapshot/settings, or reduce compositing work. Current segment/graphic caches work; do not rebuild them blindly. |
| 4 | Five-second heavy marked check | 33.63 | `packages/render/src/compile.ts:432`, `packages/render/src/compile.ts:654` | Prune/rebase a marked snapshot before text/graphic preparation and final graph construction; verify audio/caption/range parity. |
| 5 | First capture of three short HTML graphics | 21.01 (part of rank 2) | `packages/server/src/graphics.ts:98`, `packages/server/src/graphics.ts:193` | Audit certified idle intervals; cold run captured 270 screenshots, no reused frames. Warm graph cache already avoids captures. |
| 6 | Volume through multiple panel steps | 15.00 assumed | `packages/app/src/components/Inspector.tsx:88`, `packages/app/src/components/Inspector.tsx:167` | Consider a direct volume affordance/command after observing actual use. It is 4 actions cold, often 2 when the audio tab is remembered. |
| 7 | Library import then place | 5.00 assumed | `packages/app/src/lib/import.ts:26`, `packages/app/src/components/MediaPanel.tsx` | Prefer supported direct-to-track drops / Shift+A in the daily path; change library auto-placement only after a product decision. |
| 8 | Far seek leaves zoomed timeline behind | 5.00 assumed | `packages/app/src/components/Viewer.tsx:638`, `packages/app/src/components/Timeline.tsx:287` | Bring the playhead into view for an explicit clock jump while paused, preserving ordinary scrubbing behavior. |
| 9 | Drop at playhead silently vanishes | 5.00 assumed retry cost | `packages/app/src/components/Timeline.tsx:465`, `packages/app/src/components/Timeline.tsx:851` | Resolve the underlying track by row geometry during media drag, or bypass playhead hit interception for those drops. Keep normal playhead scrubbing. |
| 10 | Return to completed export after working | 3.00 assumed, code-derived alternative | `packages/app/src/components/Header.tsx:70`, `packages/app/src/components/ExportDialog.tsx:198` | Persistent completion action/notice with Play and Reveal; measure closed-dialog flow separately after implementation. |
| 11 | Task undo is per batch | 3.00 assumed | `packages/app/src/components/AgentTasks.tsx:131`, `packages/app/src/lib/store.ts:431` | Group/restore a task's full edit with an explicit task boundary; preserve concurrent user edits. Standard fixture needed 3 undos. |
| 12 | Mandatory repeated preflight wait | 2.24 at 3 × warm-heavy check (part of export totals) | `packages/app/src/components/ExportDialog.tsx:39`, `packages/app/src/components/ExportDialog.tsx:177` | Move the same guarded preflight into quick-export flow; do not remove blockers or stale-revision checks. |
| 13 | Repeat export still needs Start confirmation | 1.50 assumed | `packages/app/src/components/Header.tsx:71`, `packages/app/src/components/ExportDialog.tsx:177` | Task 27's remembered-settings quick action is justified; retain first-run settings review. |
| 14 | Repeated multi-delete feedback | 0.66 at 20 × heavy median | `packages/app/src/lib/actions.ts:53`, `packages/app/src/lib/store.ts:371` | Already ~33 ms to paint, optimistic. Keep behavior; no rewrite justified by this result alone. |
| 15 | First-load 296 ms freeze | 0.296 measured once | `packages/app/src/lib/glgrade.ts:135`, `packages/app/src/components/Viewer.tsx:121`, `packages/app/src/components/Timeline.tsx:241` | Measure production-mode first-load WebGL/context setup; consider deferring initialization beyond initial UI paint and avoiding the startup forced layout. No post-load 200 ms freeze was established. |

Cost of searching through the 33–37-control inspector, manually reviewing an agent reply, waiting after a silent refusal and recovering a failed render was **not timed with a person**. Those potentially larger losses remain unknown. This is why priorities should not be interpreted as precise productivity savings.

## Separate bug list

1. **Animated-text native spawn failure:** an initial heavy variant with 120 fade-animated text layers failed cold, warm and marked with `spawn ENAMETOOLONG` in the final pass (66.29 / 32.46 / 32.65 s to error). It is not the static-caption baseline. `measure-compile.mjs` reproduces a ~37,667-character unquoted command payload / 29,942-character filter argument / 148 inputs versus ~7,211 / 6,044 / 29 with static-caption streaming. `compile.ts:598` builds per-text filters; `run.ts:40` passes them as native spawn arguments. Proposed: graph script/file transport or bounded composition passes. Failed-attempt seconds/min are **not successful export throughput**. Evidence: `export-animated-text-diagnostic.json`, `heavy-animated-text-diagnostic.json`, `compile-results.json`.
2. **Media drop on playhead:** six confirmed silent no-ops; off-playhead controls succeed. Proposed target-resolution fix at the lines above.
3. **Clock jump off-screen at editing zoom:** displayed time and preview update, timeline stays behind; Fit restores visibility. Reproduced in both fixtures. Default-fit opening masks it.
4. **Remembered export file name/suffix resets:** first review export is `light - مراجعة.mp4`; reopening the retained review preset defaults to `light.mp4` (same pattern on Heavy). `ExportDialog.tsx:29` explicitly strips saved fileName and initializes the name from the project. This is observed behavior; Claude should decide whether naming persistence is intended. Codec/preset memory itself works.

No broken source edit, wrong moved clip or corrupted export was established in the successful baseline. All four findings remain unfixed.

## Repeatability, validation and limits

- Action counts and success/failure outcomes repeated consistently in the final three-trial operation suite: 84 successful operations plus six expected silent-drop failures. Six MCP calls and three undo batches repeated in all three briefs. UI inventories are saved with individual labels.
- **The requested ±10% timing stability is not established.** Preliminary independent editor rounds differ by more than 10% for several ms-scale operations; cold/warm states must not be mixed. For example, cold Light export in an earlier valid static run was 7.87 s versus 9.44 s in the final export run; this is ~20%, not ±10%. Warm MCP briefs were 8.82 / 9.24 s (~4.8% apart), but that does not certify every metric. Keep medians/ranges, fixed cache state and host-idle conditions for future comparisons. No timing assertions were weakened to manufacture a pass.
- The first-load 296 ms freeze has a complete CPU profile and trace interval, not a guessed component. Post-load windows had none over 200 ms. Performance sampling/automation can affect absolute timings.
- The synthetic speech fixture excludes Whisper, recognition quality, human review time, paid model latency and MCP reasoning. Historical costs reflect real old requests only; the simulated card is clearly labelled.
- Export coverage is preview/small H.264 720p with burned text, full and [5,10] range. Other codecs, final 1080p/4K, multi-file real footage and Electron were not performance-certified. Visible Explorer selection was confirmed for both marked fixtures; native observation times are controller-inclusive upper bounds, separate from automatic render timings.
- Required checks: **373 tests / 75 files passed** (two Vitest workers); typecheck passed; app build passed. Logs are `tests.log`, `typecheck.log`, `build.log`; no new product tests were added because no application code changed.
- Cleanup: all QA browsers/owned servers stopped, all isolated data roots deleted, including the two earlier import runs that required a separately validated PowerShell cleanup after Windows locks. Only evidence/scripts/fixtures remain in ignored artifacts. Protected-file/hash and final port/status evidence is recorded in `final-audit.json`. Existing uncommitted SOL/style-history changes are preserved; final tracked work is this report, an appended SOL Report entry and an appended IMPROVEMENTS entry. No commit. Stop here; Tasks 27–31 were not started.

Task 26 measurements are delivered for review, with the strict ±10% timing criterion explicitly unmet. Claude should review the confirmed bugs and revise later tasks around measured causes rather than treat every modelled priority as a required feature.
