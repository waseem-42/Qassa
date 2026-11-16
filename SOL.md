# SOL — work orders for قَصّة (Qassa)

You (sol) build; Claude is the project manager and reviews your work. The user writes in Arabic; UI text is Arabic.

## How to work

1. Read `CLAUDE.md` (or `AGENTS.md`) first. Then read the end of `docs/IMPROVEMENTS.md` to see how features are written up, and read `brand/README.md` for the design system. Every UI change follows that design system: the tokens in `packages/app/src/index.css` `@theme`, the existing components in `components/ui.tsx`, and RTL.
2. Do the tasks **in order**, one at a time. After each task, check:
   - `npm test`: all pass. A new kind of edit is a new op in `packages/shared/src/ops.ts`, and it needs a test.
   - `npm run typecheck`: clean.
   - `npm run build -w packages/app` (or the app's build script): passes.
   - The feature works in the real editor (`npm run dev`, http://localhost:5173). puppeteer-core plus the system Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`) works for headless checks.
3. **Never touch the user's projects**: everything in the repo's `projects/` (on 2026-11-16: «ad-for-shafi», «night-qa», «تبصر-جرم-صغير», «تجربة», «تشويقة», «شرح-الأردوينو», «شرح-قصة», «يار-بودكاست-تبصر», «يارا-تشويقة», plus `projects/.folders` and `projects/.trash`). To test, make a temporary project in an isolated `EDIT_DATA_DIR` and delete it afterwards.
4. **Don't commit.** From 2026-11-07 the repo has a baseline commit. Claude reviews each task and commits it; you leave your changes uncommitted. Never run `git reset`, `git checkout -- …`, `git stash` or `git clean`.
5. Keep the code style of the file you edit: same naming, same comment density (short "why" comments, no essays).
6. After each task:
   - Add a short entry at the bottom of `docs/IMPROVEMENTS.md`.
   - Add a line under **Report** at the bottom of this file: done / what changed (files) / what you could not do / anything Claude must decide.
7. If a task is unclear or needs a product decision, write the question under **Report**, then do the next task. Don't guess on anything destructive.
8. If you change MCP tool docs or ops, update `.claude/skills/edit-tool/SKILL.md` and its copy `.agents/skills/edit-tool/SKILL.md`. Also update `CLAUDE.md` and `AGENTS.md` when a rule changes.
9. **Runs started by Claude (`codex exec`).** Claude starts you with one task, and you do only that task.
   - When it is done, or when you are blocked, write the Report entry and stop. Claude reviews it, then sends fixes or the next task.
   - A fix order from Claude appears under that task as **Review by Claude**. Do what it lists, then add a «fixes» line to your Report entry.
   - Claude may be editing other files at the same time. Don't revert or reformat changes you didn't make.
   - Don't stop the user's own servers on 5173/4317. Use other ports and an isolated `EDIT_DATA_DIR` for QA, as before.
   - Put screenshots and QA scripts in `artifacts/qa/<task>/` (ignored by git), so Claude can open them.

---

## Task 1 — Sound waves on the timeline

**User:** "I want to see the sound wave on the timeline."

**What exists:**
- `Timeline.tsx` (`TrackRow`, the canvas effect around "draw filmstrip + waveform") already draws peaks: on video tracks in the bottom 32% of the clip, and on audio and overlay tracks at full height.
- The drawing only happens when `analysis[mediaId].peaks` exists. Peaks come from `analysis/analyze.py` → `make_peaks` → `projects/<p>/analysis/<mediaId>/peaks.json` (`{rate:50, data:[0..1]}`).

**Real cause found:**
- The user's projects have **empty `analysis/` folders**: no peaks.json for any media, not even the SFX wavs. So nothing is drawn.
- Waves must not depend on a full analysis having run once and its output surviving.

**Do:**
1. **Peaks on demand.**
   - When a media (video or audio, any role) has no `peaks.json`, the server makes it. Prefer a fast path with no Python: ffmpeg → mono PCM → max-abs per 1/50 s, normalised the same way as `make_peaks` (99.5th percentile).
   - Trigger it when the project loads, or when the timeline requests analysis for the media.
   - Write it to the same path so the existing reader works, then push the update so the timeline redraws.
   - Don't queue a whole analysis job for it.
   - Find out why the analysis folders are empty: is something deleting them, or did the analysis fail? Write what you found in the Report.
2. **Make the wave readable.**
   - On the main track (V1) the wave sits under the filmstrip, but it is too small to edit by.
   - Add a timeline toggle (rebindable shortcut in `lib/keys.ts`, plus a button in the timeline toolbar), remembered per viewer in localStorage. Its state shows the wave large: V1 is taller and the wave takes about half of it.
   - Audio tracks (music, SFX, voice) always show a full-height wave.
3. **The wave shows what will be heard:**
   - Scaled by clip volume (and track mute dims it).
   - Follows fades in and out where the clip has them.
   - Follows speed (already uses `c.speed`).
   - Silence cut by the user is simply not there, because clips already skip it.
4. **Colours from tokens,** not hard-coded rgba. Use the clip colour family (`clip-*` tokens) so video, voice and music waves are distinguishable in dark and light.

**Done when:**
- A fresh project with a video and a music file shows waves on V1 and the audio track within seconds of import, without running Whisper.
- The toggle works.
- Volume changes reshape the wave.

---

## Task 2 — Trash: delete for good, and auto-purge after 30 days

**User:**
- "In the trash I can delete anything for good."
- "Or after 30 days it is deleted for good by itself."

**What exists:**
- `packages/server/src/project-management.ts` moves projects to `projects/.trash/<uuid>/{entry.json, project/}`.
- It has `list()` and `restore()`, and routes `GET /api/projects/.trash` and `POST /api/projects/.trash/:id/restore`.
- UI: `Home.tsx`, the «المحذوفات» section with `trash-card` items (restore only).
- The code is careful with paths (`assertSafeTree`, `assertWithin`, `assertNoLink`). Keep that care for deletes.

**Do:**
1. **Server:**
   - `DELETE /api/projects/.trash/:id`: permanently remove that entry's folder. Validate the uuid, stay within `.trash`, never follow links, and refuse while jobs run for that name.
   - `DELETE /api/projects/.trash`: empty all of it.
   - Restored entries keep a tiny envelope (see the comment in `restore`). Purge those too.
2. **Auto-purge:**
   - When the server starts, and then every few hours, permanently delete entries whose `deletedAt` is more than 30 days old.
   - Keep the 30 days in one named constant.
3. **UI:**
   - Each trash card shows how long is left ("يُحذف نهائياً بعد 12 يوم"), using the same date helpers as the card.
   - Add a «حذف نهائي» button with a confirm Modal. The Modal names the project and says it can't be undone (`btn-danger`).
   - Add a «إفراغ المحذوفات» action with a confirm showing how many projects will go.
   - Change the hint text so it mentions the 30 days. The delete dialog's subtitle must also say that the trash empties itself after 30 days.
4. **Tests:** server tests for both routes and for the purge rule (fake dates). Run them against a temp root, never the real `projects/`.
5. **MCP:** don't add permanent delete to the MCP tools; it stays a user action. Do mention the 30-day purge in the `project_trash` tool doc.

---

## Task 3 — Identity: upload a brand file and the project takes it

**User:**
- "There should be a way to upload you a file and it does it itself."
- "All my identities are made by Claude or another AI, so make a proper way to upload an identity."

**What exists:**
- `settings.theme`: accent, accent2, panel, text, font, direction (`packages/shared/src/schema.ts` `Theme`).
- The «الهوية» tab in `Inspector.tsx`: `ThemeSection`, `ThemeSample`, `ThemeReach`.
- 7 bundled Arabic fonts in `THEME_FONTS` (`packages/shared/src/text.ts`), served from `/api/graphics/fonts.css`.
- Graphics and text presets read the theme. Some AI-written graphics hard-code colours; `ThemeReach` lists those.

**Do:**
1. **Brand kits, kept across projects.**
   - Stored in a new top-level `brands/<id>/`: `brand.json` plus the uploaded original plus the extracted assets (logo files, font files).
   - Like `styles/`, a kit is reusable in every project.
   - `brand.json` holds:
     - name;
     - theme fields (accent, accent2, panel, text, font, direction);
     - extra palette colours;
     - logos (paths);
     - fonts (family to file);
     - a short voice/notes text if the file has one;
     - the source file name;
     - when it was added.
2. **Upload accepts what AI tools usually produce:**
   - `.md`, `.json`, `.css`, `.html` (a design-system page or tokens file), `.zip` (a folder with files, logos and fonts);
   - images (a logo, or a brand sheet as PNG/JPG);
   - `.pdf` if cheap to support.
   - There's a drop zone in the identity tab, and an «ارفع ملف هوية» button.
3. **Extraction, cheap first:**
   - **Deterministic parse:**
     - CSS custom properties (`--accent`, `--primary`, `--brand-*`, `--bg`, `--text`…), JSON tokens (W3C design-tokens or flat `colors{}` / `fonts{}`), `font-family` declarations, `@font-face` files.
     - Markdown/HTML with hex colours next to names like primary/accent/background/text.
     - Logo files: svg/png named logo/mark/icon.
   - **AI fallback (opt-in button, shows the cost like other AI tasks):** only when the parse finds too little, or for an image/PDF. Run one `quick`-tier `claude -p` task through `agent.ts` that reads the file and returns `brand.json`. It is logged in `ai-tasks.jsonl` like the others.
4. **Review before it applies.**
   - Show the extracted kit: swatches, font sample in Arabic, logos, and which theme field each value goes to. The user can swap a value with a click.
   - «طبّق على المشروع» sets `settings.theme` through the existing op, so it can be undone. It also records `settings.brand = <id>`, which needs a schema field and a test.
   - A font file from the kit is served next to the bundled fonts (extend `fontFiles()` / `fontFaceCss` to include brand fonts) so the preview and the renderer both use it.
5. **The identity tab:**
   - Shows the applied kit at the top: name, swatches, logo.
   - Lists saved kits to switch between, plus upload. Manual colour pickers stay as a folded «تعديل يدوي».
   - Keep `ThemeReach`: after applying, it shows which graphics still ignore the identity, with its existing fix.
6. **MCP:**
   - A `brands` tool that lists kits and reads one, so Claude uses the logo, palette and voice when making graphics.
   - Mention it in the skill: "use the project's brand kit when making graphics."
7. **Tests:**
   - Parser unit tests on 3–4 sample files: a CSS tokens file, a JSON tokens file, a markdown brand doc, and a messy HTML page. Put them in `packages/server/test/fixtures/brands/` and write them yourself, small.
   - Schema/op test for `settings.brand`.

---

## Task 4 — Remove colour grading from the UI

**User:** "The colours feature is useless. I'm only making a cut here, I won't grade."

**Do:**
- Remove the «ألوان» tab from the clip inspector (`Inspector.tsx` `TabId 'color'`, `ColorSection`).
- Remove it from the project tabs (`['project', 'theme', 'color', 'sfx']`).
- Remove the colour entries from clip menus, shortcuts and the tool rail, if any. Search for `ColorSection`, `defaultGrade`, `grade`, `LUT`, `'color'`.
- **Keep the data and the renderer:**
  - Existing grades and LUTs in projects still render.
  - Styles that set a look still apply.
  - The ops and the MCP tools stay, since Claude may still use them when asked.
- Only the manual UI goes. If a clip already has a grade, show one quiet line in the clip summary («عليه تلوين — إزالة») so it isn't invisible.
- Delete code that becomes unused, and its CSS.

---

## Task 5 — The project tells which library styles it used

**User:** "About the styles in the library: the project should tell me which styles I used."

**What exists:**
- The built-in looks are `STYLE_PRESETS`. Saved styles live in `styles/`. Upstream editing/motion references are in the style library, read through `/api/style-library` and the MCP tools `style_library` / `style_reference`.
- Favourites are in `styles/favorites.json`.
- `project.style` holds only the active analysed profile.
- `apply-style` (`server/src/index.ts`) applies a look and returns its name, but nothing records it.

**Do:**
1. **Record each use** in the project. Add `project.stylesUsed: [{id, name, source: 'preset'|'saved'|'library', at, by: 'user'|'claude', what}]` (schema + op + test), where `what` is a short line such as «لون + خط الترجمة» or «مرجع لرسمة المقدمة». Write an entry when:
   - `apply-style` runs, from the UI or the MCP `apply_style`;
   - Claude reads a library entry with `style_reference` while working on a project;
   - Claude marks it with a new optional `project` argument on `style_reference`, or a small `log_style` op. Prefer the op so it goes through history.
   - Keep one entry per id: update `at` and `what`; don't duplicate.
2. **Show it:**
   - In the project tab of the inspector: a «الستايلات المستخدمة» list with name, source, when, and what for. Clicking an entry opens it in the styles window.
   - A badge on those entries inside the styles window: «مستخدم في هذا المشروع».
3. Update the MCP `apply_style` / `style_reference` docs and the skill so Claude always logs a library style it used.

---

## Task 6 — Styles library: better UI and a «recently used» history

**User:**
- "Develop the styles library UI."
- "Make a place for the last thing I used, like a log of them."

**What exists:**
- `Styles.tsx`: the window with tabs library / editing / favorites.
- `EditingStyles.tsx`: `SourceLibrary`, `StyleTile`, `Preview`, `FavoriteButton`, `categoryLabel`.
- The server: `/api/style-library` (q, source, category, sort, favorites, offset, limit, preview).

**Do:**
1. **Recently used, global across projects.**
   - Stored in `styles/recent.json` (newest first, capped at about 50).
   - Each entry: `{id, source, project, at, by}`. Fed by the same events as Task 5, plus opening a style's details.
   - Server routes: `GET /api/style-library/recent`, `DELETE` one, and `DELETE` all.
2. **A «الأخيرة» tab** in the styles window, first or second.
   - It's grouped by day (اليوم / أمس / هذا الأسبوع / أقدم).
   - Each item shows the project it was used in, and has a "use again" action.
   - The empty state explains what will appear there.
3. **UI improvements,** within the design system:
   - **Tiles:** a consistent aspect, the preview plays on hover/focus (it already exists in `Preview`; make it smooth and lazy), a clear title with the source eyebrow, and favourite plus "used here" badges.
   - **Filters:** category as chips instead of the `<select>`, the source as segmented control, and search that stays sticky at the top.
   - **Detail view:** a big preview, a description, the source with its licence, «استخدم في المشروع», favourite, and the projects it was used in (from Task 5's data).
   - **Keyboard:** arrows move between tiles, Enter opens, and Esc closes the detail view.
   - Phone width and RTL must work, with no horizontal scroll.
   - Keep the performance: lazy previews, and only the visible tiles' videos play.
4. Screenshot the before and after: save them in the scratch area, not the repo, and write their paths in the Report.

---

## Task 7 — Import without the paperwork

**User (2026-11-05):** "Uploading media is not practical at all. It doesn't suit the customer's experience."

**What exists:**
- `MediaPanel.tsx` `MediaList`: you must pick a role (مقطع / رفرنس / بي-رول / موسيقى) *before* uploading, then use one small drop zone.
- After upload, a file goes on the timeline only through per-role buttons («+ للتايملاين», «+ عند المؤشر», «+ للمشروع»).
- There is no drag from the media list to the timeline. Upload shows a count, with no per-file progress and no cancel.

**Do:**
1. **Drop anywhere, decide later.**
   - Files dropped on the media panel, the viewer, the timeline or anywhere in the editor window are uploaded straight away. No role is picked first.
   - The server guesses the role:
     - video or image: `source` while the main track is empty, else `broll`.
     - audio: `source` (the spine) while the main track is empty, else `music`.
   - Each media card shows its role as a small chip the user can change afterwards.
   - Changing the role must not move clips already placed.
   - Remove the role buttons above the drop zone.
2. **Drag a media card onto the timeline.**
   - Dropping a card on a track at a point places a clip there:
     - V1: inserted at the clip boundary nearest the pointer.
     - overlay: at that time.
     - audio track: sound only (see Task 8).
   - Dropping below the last track makes a new track of the fitting kind (Task 9).
   - Files dragged from the OS straight onto a track do the same once uploaded.
   - Show the same dashed landing box the clip drag already uses.
3. **Honest upload.**
   - Per-file progress (XHR upload progress) and a cancel button.
   - The card appears at once with its name and progress, and becomes usable when the upload is done.
   - Analysis keeps running in the background as today.
4. Home «ابدأ من فيديو» keeps working (it already uploads as source).

**Done when:**
- A new user can drop a video and a song into an empty project and has both on the timeline, without reading any role names.
- Dragging a b-roll card onto V2 at 0:12 puts it at 0:12.

---

## Task 8 — Use only the sound of a video

**User:** "If I bring in a clip, I should be able to take only its sound, without its picture."

**What exists:**
- `detach_audio` (clip menu «فصل الصوت») moves the sound to an audio track, but the picture stays.
- Deleting the picture on V1 then closes the gap and shifts the whole edit. So "sound only" takes two steps and breaks timing.
- Audio media on the main track now plays over black, in the editor (`Viewer.tsx` `Seg.audio`), the render (`compile.ts` `blackInput`) and contact sheets (`sheets.ts`). This was fixed by Claude 2026-11-05; reuse that path.

**Do:**
1. **A «صوت فقط» switch on a clip** (clip menu + inspector), as `picture: { off: true }` on the clip (schema + `update_clip`, plus a test in `packages/shared/test`).
   - On V1 the clip keeps its place and length. It shows black, or whatever is on the tracks above. It renders like an audio media (reuse the black-input path in `compile.ts` and `sheets.ts`, and `Seg.audio` in the viewer).
   - On an overlay track the clip shows nothing and keeps its sound.
   - The timeline draws a sound-only clip as a wave, with no filmstrip.
2. **Drop a video on an audio track = its sound only.**
   - `add_clip` of a video media on an audio track is allowed.
   - Check that the viewer's audio elements play an mp4's sound, and that the render takes its audio stream. Add a test if not.
3. In the media card menu: «أضف الصوت فقط» puts the video's sound on a free audio track at the playhead.

**Done when:**
- From one video you can put only its sound on V1 or on an audio track, in one action, without the edit shifting.
- Preview and export agree.

---

## Task 9 — A timeline that fits the way I work today

**User:** "The timeline layout is nice but needs work, because my work changes. Maybe I put a voice and edit on top of it, maybe I put a clip. The timeline limits how I can use it. Improve the experience."

**What exists:**
- Four fixed tracks from `defaultTracks()` (`shared/src/schema.ts`): V1 «رئيسي» (magnetic), V2 «بي-رول», T1 «نصوص», A2 «موسيقى».
- `add_track` and `set_track` (name, mute, hide) exist as ops, but there is no UI to add, remove or reorder tracks.
- Every audio track is mixed as music: ducked under the voice (`compile.ts` sidechain) and faded in and out over up to a second. So a voice or podcast on an audio track gets ducked.

**Do:**
1. **Tracks from the timeline.**
   - A «+ مسار» button in the track header column with three choices: فيديو/صور فوقي، نص، صوت.
   - Track header menu: rename, delete (only when empty, or confirm with the clip count, undoable), move up/down.
   - New ops as needed: `remove_track`, and `move_track` or `add_track` with an index. Each op needs a test.
   - Graphics and b-roll can go on any overlay track (already allowed). Text only on text tracks.
2. **Audio tracks say what they hold.**
   - A track-level `audio: 'music' | 'voice'` (default `music` for existing tracks).
   - `voice` is never ducked or auto-faded. It counts as speech for ducking the music, like V1's sound.
   - The track header shows a small toggle.
   - The render (`compile.ts`) and the live preview follow it, with a test.
3. **The main track holds whatever the story is built on.**
   - V1 accepts video, image or audio (audio already plays and renders, see Task 8).
   - When V1 is mostly sound, the timeline opens with the large wave (Task 1 toggle) on.
   - Rename V1 «الأساسي» in the UI, with a tooltip: what plays in order; the rest sits on top of it.
4. **Start shapes for new projects.**
   - On the empty-project screen and Home «مشروع جديد», offer three starts:
     - «فيديو» (today's tracks).
     - «صوت/بودكاست» (V1 for the voice, two overlay tracks for visuals, text, music).
     - «فارغ» (V1 only; add tracks as you go).
   - Only the starting tracks differ; nothing is locked.

**Done when:**
- The user can build a podcast edit (voice spine, two visual tracks, music under it) and a video edit, both from the timeline alone, without the voice being ducked.
- Tracks can be added, renamed, reordered and removed, all undoable.

---

## Task 10 — Sound-only projects play; nothing is transcribed unasked (urgent, after Task 9)

**User (2026-11-05, project «تشويقة»):** the viewer shows «يجهّز المقطع… أول ما يخلص البروكسي…» for a project that only has sound. "I don't want it to transcribe the audio unless I tell it to."

**Found:**
- «تشويقة» has two audio files, both `role: source`, both placed on **A2**; V1 is empty. Analysis finished long ago.
- `Viewer.tsx` shows `EmptyViewer` («يجهّز المقطع…», spinner) whenever V1 has no playable segment and any source media exists, even when nothing is running. It covers the viewer forever.
- Playback is driven only by V1 segments (`tick()` advances `time` from the active V1 element). A timeline whose clips are all on other tracks, or a playhead past V1's end, cannot play at all.
- `stepsFor()` (`server/src/media.ts`) runs `transcribe` + `silence` for every audio source and every video source on upload. Whisper ran for a file the user only wanted to place.
- Media names arrive broken: «��302 تيك توك�». Some characters of the original file name (probably emoji or special brackets) are lost in the multipart filename decoding.

**Do:**
1. **The viewer never claims to be preparing when it isn't.**
   - Show «يجهّز المقطع…» only while an analysis job is actually queued or running for a media that will give the main picture, and the timeline has no clip yet.
   - With any clip on any track, show the frame (black where nothing is drawn) and play.
   - With no clips and nothing running, show the drop prompt.
2. **Play without V1.**
   - When no V1 segment covers the playhead (empty V1, gaps, after its end), the transport runs on wall time (`performance.now()`, as stills already do).
   - Audio tracks, overlays, graphics, text and SFX follow it.
   - The project length is the end of the last clip on any track (check `total` and the export duration agree, and that `compile.ts` pads V1 with black to that length if it doesn't already).
   - Add a test for the render side.
3. **No transcription unless asked.**
   - Upload analysis does probe, proxy, peaks, thumbs and shots only. Check whether `silence` needs the transcript: keep it if it is energy-based, drop it if not.
   - Transcription starts only on request:
     - «فرّغ الكلام» on the media card and in the transcript panel's empty state.
     - Claude's `analyze` MCP tool.
     - An AI task that needs words (cuts, captions, ideas). It may queue it, and the UI says so («المساعد يحتاج التفريغ — يبدأ الآن»).
   - Features that need a transcript (captions, cut suggestions, notes context) show «يحتاج تفريغ» with the button, instead of failing or silently doing nothing.
   - Update the skill (both copies) and CLAUDE.md/AGENTS.md: Claude transcribes (`analyze` with transcribe) before word-level work, and tells the user.
4. **Role follows placement.**
   - A sound dropped on an audio track that is not a voice track becomes `music` (no transcription, ducked).
   - On a voice track or V1 it stays `source`.
   - Don't change clips on role change (Task 7 rule).
5. **File names:** decode multipart filenames as UTF-8 (busboy `defParamCharset: 'utf8'` or equivalent) and keep emoji and brackets. Add a test with «🎙️【302】 تيك توك.wav».

**Done when:**
- «تشويقة»-like project (two sounds on A2, empty V1) shows a black frame and plays both sounds at their times.
- Uploading a sound or video starts no Whisper job.
- «فرّغ الكلام» does, and captions then work.
- The name is kept exactly.

---

## Task 11 — In/Out marks and selecting on the timeline with the mouse

**Latest user clarification (2026-11-07):** drag the playhead line/head with snapping at cuts. Export In/Out must also drag and snap, but only by dedicated handles in a separate upper lane. Ordinary ruler clicks/drags and empty-space/Alt bands must never set a render range. This refines the earlier keyboard-only correction; I/O shortcuts remain available.

**User (2026-11-05):** "I want I and O on the timeline to mark a start and an end of what I export. And I want to select on the timeline with the mouse what I want, dragging below."

**What exists:**
- No marks.
- Export takes a part only through the «جزء منه» fields typed by hand in `ExportDialog.tsx`, via `range: [t0, t1]`, which the render and the MCP `render` tool already support.
- Clips are selected one by one (click, Shift/Ctrl click). There is no rubber-band selection.
- Shortcuts live in `lib/keys.ts`. `I` and `O` are free.

**Do:**
1. **In/Out marks.**
   - `I` sets the In at the playhead, `O` sets the Out. `Alt+I` / `Alt+O` clear one, `Alt+X` clears both. All are rebindable in `keys.ts` (physical keys, so they work on an Arabic layout).
   - The marks belong to the project, so they survive reloads and Claude can read them: `settings.marks: {in?, out?}` in timeline seconds, set by a new undoable op `set_marks`, with a test.
   - If O is before I, swap them.
   - Marks keep their timeline time. They are not re-anchored on V1 edits, like an NLE.
2. **Show them.**
   - On the sticky ruler: an In bracket and an Out bracket, the span between them tinted (token colour, not hard-coded), and the outside slightly dimmed across all tracks.
   - In/Out grips occupy a separate upper lane. They drag with magnet snapping to clip edges/playhead/comments, without moving the playhead; one drag is one undo.
   - With no saved marks, default start/end grips are visible without modifying the project. The first drag creates the marked range; clearing restores the defaults.
   - The timeline toolbar shows the marked length (`00:12.4`) with a clear (✕) button.
3. **Mouse.**
   - **Drag the playhead line/head, or click/drag on the lower ruler** to move the playhead with snapping to fixed clip edges/comments, without changing In/Out or creating project undo entries. Never snap the moving playhead to itself. N toggles snapping; Alt bypasses it during a drag.
   - **Drag on empty space in the tracks area** (start not on a clip) draws a rubber-band rectangle that selects every clip it touches on the tracks it crosses. Shift adds to the selection, Ctrl toggles.
   - **Alt-drag on empty space** follows ordinary clip selection and never changes In/Out.
   - Keep the existing clip drag and the comments lane as they are.
4. **Use the marks.**
   - Export opens on «جزء منه» filled with the marks when both are set, labelled «من العلامات I/O». Without marks it opens on the whole video, as today.
   - The MCP `render` tool and `project_summary` mention the marks, so Claude exports the marked part when the user says «صدّر المحدد».
   - Space+Shift (rebindable) plays from In to Out.
   - Delete with a range marked and no clip selected removes that stretch from the edit across tracks, as one undo: V1 through its source mapping, free clips trimmed or split. Show a hint before the first time, since it is destructive.
5. Update the skill (both copies) and the shortcuts sheet (`?`).

**Done when:**
- The user presses I at 0:10 and O at 0:25, sees the tinted span, and exports only those 15 seconds without typing times.
- Dragging on empty timeline space selects the clips under the band.
- Dragging on the ruler scrubs the playhead and leaves the marks unchanged.

---

## Task 12 — Qassa as a Windows desktop app (after Tasks 10 and 11)

**User (2026-11-05):** chose a desktop app over a website. All heavy work stays on the user's machine (Whisper on the GPU, ffmpeg NVENC, frame-by-frame graphics in a browser, GB-sized media, Claude Code locally).

**Goal:** one installer, `Qassa-Setup.exe`. A user with no Node, Python or ffmpeg installs it, opens قَصّة from the Start menu, and edits. `npm run dev` keeps working exactly as today for development.

**Do:**
1. **Separate code from data.**
   - Today `config.ts` puts `projects/`, `brands/`, `styles/` and `sfx-lib/` under the repo root.
   - Add `EDIT_DATA_DIR`:
     - Default in the app: `Documents\Qassa`.
     - Default in dev: the repo root, unchanged.
   - Read-only resources (`graphics-lib/`, `analysis/`, built-in styles, fonts) come from the app's resources folder.
   - Nothing writes inside the install folder.
2. **`packages/desktop` (Electron).** The main process:
   - Takes a single-instance lock.
   - Picks a free port and starts the server as a child process with `EDIT_PORT` and `EDIT_DATA_DIR`. Use the server built to plain JS with esbuild or tsup; no tsx at runtime.
   - Waits for `/api/health`, then opens a window on the server-served app build (`packages/app/dist`). Window title قَصّة, icon from `brand/`.
   - Writes the port to `EDIT_DATA_DIR/.port` so the MCP server and `claude -p` tasks find it.
   - On exit, kills the server child and its ffmpeg/python children.
   - If the server crashes, restarts it and tells the user. Running jobs are reported as failed, never silently lost.
   - Logs go to `EDIT_DATA_DIR/logs/`.
3. **Graphics browser.**
   - `BROWSER` falls back from Chrome to Microsoft Edge (`msedge.exe`, present on every Windows 10/11). Then no Chrome install is needed.
   - Keep puppeteer-core. Do not try to drive Electron's own Chromium.
4. **Heavy dependencies on first run, not in the installer.**
   - Bundle a static ffmpeg build with NVENC in resources. Check its licence notice and include it.
   - Python (embeddable 3.11), faster-whisper, CUDA libs, scenedetect, opencv and the Whisper model download on first run (several GB):
     - A setup screen in the app shows size, progress, pause/resume and retry.
     - It runs `nvidia-smi`: GPU → CUDA build; no NVIDIA → CPU int8, with a note that transcription will be slower.
     - It mirrors what `setup.ps1` does today; reuse its package list.
   - Until it finishes, the editor works for everything except analysis and transcription, which show «يحتاج إكمال التجهيز».
5. **Claude.**
   - Settings shows whether the `claude` CLI is found: AI tasks need it, the editor does not.
   - A «ربط Claude Code» button:
     - Runs `claude mcp add` (or shows the exact command) for the bundled MCP server.
     - The MCP server reads `.port` instead of auto-starting a second server.
6. **Installer.**
   - electron-builder NSIS, per-user install (no admin), Start-menu and desktop shortcuts, uninstaller that keeps `Documents\Qassa`.
   - No auto-update yet. Keep the version in `package.json`.
7. **Docs.**
   - `npm run desktop` (dev) and `npm run dist:win` (installer).
   - Update `CLAUDE.md`, `AGENTS.md` and both skill copies for the data dir and port file.

**Done when:**
- On a Windows user profile with no Node, Python or ffmpeg on PATH (a fresh local user account is enough), the installer runs, first-run setup completes, and a new project can import a video, transcribe it, add a library graphic and export an MP4.
- Closing the app leaves no `node`, `ffmpeg` or `python` processes behind.
- `npm run dev` and `npm test` still pass unchanged.

**Questions for the user (write them under Report, don't block on them):**
- Code signing: without a certificate, Windows SmartScreen warns on install.
- Whether existing projects should move from the repo folder to `Documents\Qassa` (offer a one-time «انقل مشاريعي» button; never move them silently).

---

## Task 13 — Captions follow the words they show (small, after Task 12)

**Found by Claude (2026-11-05, «تشويقة»):**
- A V1 voice clip was deleted. Its 28 caption clips stayed and were re-anchored onto the deletion point: all of them start at the same second, stacked.
- The project length (and the export) then ran 3 s past the last V1 clip, with every caption shown at once.

**Do:**
- Caption clips made by `captions` remember the media and source words they show (`clip.words: {mediaId, from, to}`).
- When those words are no longer on the timeline (clip deleted, range cut), the caption goes in the same undo step. When the words are only partly left, its text shrinks to what is left.
- A test in `packages/shared/test`.
- `render_preflight` warns when two or more caption clips on one track overlap.

---

## Task 14 — Timeline and placing media: make them practical (big, after Task 13)

**User (2026-11-07):** «حسّن التايم لاين ونظام وضع الأسست، مرة سيء وغير عملي».

**Found by Claude (code + screenshots of «تشويقة» and «شرح-الأردوينو» at 1600×1000):**
1. **Clips pile on top of each other.** Nothing stops two clips overlapping on one free track. The covered clip is hidden in the timeline and in the picture.
   - Dropping media on a track: `mediaPlacementOps` (`shared/src/import.ts`) only looks for a free track when no `trackId` was given.
   - Moving a clip: `move` op and `Timeline.tsx` `onPointerUp` don't check either.
   - Paste and duplicate (`app/src/lib/clipboard.ts`): a duplicate starts at the clip's end, even when the next clip is already there.
2. **The timeline is too small to work in.**
   - Default height is 260 px, so «تشويقة» shows 2 of its 6 tracks.
   - Bug: `TimelineDock` (`App.tsx`) caps the saved height at 40% of the window on load, so a taller timeline shrinks again after a reload.
   - Rows are small (overlay 44, text 34, audio 44) and track heads are 112 px wide with tiny text. There is no way to make rows taller.
3. **Dragging is fragile.**
   - Clip move/trim never takes pointer capture. `onPointerLeave` commits the drag, so leaving the timeline drops the clip where it is.
   - Esc does not cancel a drag.
   - No auto-scroll near the edges, sideways or up and down, for clip drags or media drags.
4. **A multi-selection does not move together.** The drag moves only the clip under the pointer.
5. **Dropping media is blind.**
   - The landing spot on free tracks does not use the magnet (playhead, clip edges, comments).
   - The landing box is an empty dashed rectangle: no thumbnail, name or length.
   - A new track can only be made at the bottom lane, never between two tracks, even though overlay order decides what is on top.
6. **The media library is hard to drag from.** Each card is about 120 px tall: role select, transcribe, range, add, more and re-analyse buttons. So few files fit and the drag handle is unclear. Nothing shows which files are already on the timeline.

**Do:**
1. **No overlaps on free tracks.**
   - Add a shared helper (e.g. `freeTrackFor(p, clip|media, start, end, preferTrackId, except)` in `shared/src`). It returns the preferred track when that span is free. Otherwise it returns the nearest compatible track that is free there, or «new track right above the preferred one».
   - Use it in `mediaPlacementOps`, the Timeline move/drop code, paste and duplicate.
   - In the UI, the landing preview shows where the clip will really go, including a ghost «new track» row when it creates one. Same idea as CapCut: dropping onto an occupied spot makes a layer, it never hides a clip.
   - Do not make `move`/`add_clip` throw on overlap. Existing projects, captions and MCP ops may rely on it. Instead:
     - Draw any existing overlap on a free track with a visible warning stripe on the covered part.
     - Add a preflight warning like Task 13's.
   - Tests in `packages/shared/test`.
2. **Room to work.**
   - Fix the 40% load clamp: keep the saved height, bounded only by the window minus the viewer's minimum.
   - Raise the default to about 38% of the window, at least 300 px.
   - Add a «maximise timeline» toggle (rebindable key in `lib/keys.ts` plus a toolbar button).
   - Track height: three sizes (compact / normal / large) for all rows, remembered per viewer. Normal is taller than today, roughly video 88, overlay 56, text 40, audio 56. Ctrl+Shift+wheel over the rows changes it.
   - Track heads about 150 px, with readable names. Double-click the name to rename in place (the modal stays for move/delete).
3. **Solid drags.**
   - Pointer capture for clip move and trim.
   - Esc cancels any drag with no op sent.
   - Auto-scroll sideways near the left/right edge and up/down near the top/bottom of the rows, for clip drags and media/file drags.
   - Anything dragged out and back keeps working; a release outside the timeline commits only what the preview showed.
4. **Move the selection together.**
   - Dragging a selected clip moves every selected free clip by the same time, in one undo.
   - The magnet catches on the edges of the whole group.
   - V1 clips in the selection keep the current reorder rule. When the selection mixes V1 and free clips, move only the free ones and say so once.
   - Nudge: rebindable keys to move the selected free clips one frame (and ten frames with Shift). Pick keys that don't clash with the existing ArrowLeft/Right frame steps, e.g. `,` / `.`.
5. **See where media lands.**
   - Media and file drops on free tracks snap with the magnet, with the same snap guide and Alt to bypass. On V1 keep the cut-insertion line.
   - The landing preview is a ghost clip: first thumbnail (or ♪ for sound), name and length, at the real width. Red when the target track can't take it, with a short reason under the pointer (e.g. «النص له مسار نص»).
   - A thin drop zone between two track rows inserts a new track at that position (`add_track` then `move_track` in the same op batch, one undo).
6. **A media library you can drag from.**
   - Compact cards: thumbnail with a duration badge, name, kind icon, and a small «on the timeline ×N» mark. Hovering a video thumbnail scrubs through its frames (thumbs sheets already exist).
   - The role select and the less common actions (transcribe, re-analyse, sound only, style) go into the card's ⋯ menu. Keep «+ عند المؤشر» visible on hover.
   - Optional grid/list toggle, remembered per viewer.
   - Double-click a video opens `SourceRange` (choose a part).
   - A rebindable key adds the selected media at the playhead with the same placement as the button.

**Keep:** V1 stays magnetic, with the In/Out grips and scrub rules of Task 11 (latest clarification). Comments, ideas and caption links keep re-anchoring as now. Follow the design system (`brand/README.md`, tokens, RTL text inside an LTR timeline).

**Done when (real Chrome, temporary project with 2 videos, 1 image, 1 music file):**
- Dropping media onto an occupied span puts it on a free track or a new one. The preview shows that before release, and no clip is ever hidden.
- Paste and duplicate never cover a clip.
- A 6-track project shows all its tracks at the default height on a 1000 px tall window.
- A taller timeline survives a reload.
- Dragging a clip out of the timeline and back still works. Esc cancels. Auto-scroll works in both directions.
- Three selected clips move together in one undo.
- A drop between two rows makes a new track there.
- The media panel shows at least twice as many files as now in the same height.
- Tests, typecheck and build pass.
- Screenshots before and after in the Report.

---

## Task 15 — Claude edits better and cheaper through MCP (after Task 14)

**User priority (2026-11-07):** editing with Claude (MCP).

**Found by Claude.** Claude ran a full edit as Claude itself on a temporary project: import, transcribe, accept silences, `cut_words`, b-roll, title, captions, check_cuts, contact sheet, preflight, preview render.
1. **The `edit` tool schema is huge.** It includes `restore_project` with the whole Project schema inline, about 40 KB of JSON schema that every session loads before doing anything. `checkpoint_restore` already covers restoring.
2. **`render_preflight` dumps every font file.** About 80 «font … ready» entries (~7 KB) bury the 2 warnings that matter.
3. **`media_import` says "use job_status" but gives no job id.** Claude has to guess or poll `project_summary`.
4. **MCP placement can still hide clips.** Two b-roll clips added to V2 at 8–12 s and 10–14 s were accepted silently. Only preflight mentions it, much later. Task 14 gave the UI `freeTrackFor`, but MCP has no way to ask for it.
5. **`cut_words` keeps a sliver of a cut word.** Words 34–36 were cut and the next word starts right after word 36. The breathing pad put the new in-point at 20.00 s, inside «أطفالنا» (36), so `check_cuts` warns «cuts inside «أطفالنا»». The pad must never go back into a word that was cut.
6. **`cut_words` leaves the pause in front of the cut words.** Cutting a phrase that came after a 1.7 s pause leaves «1.7s of silence across the cut».
7. **Energy-based silence missed transcript pauses.** The transcript shows pauses of 1.7 s and 1.6 s (16.1–17.9 and 53.3–54.9), probably with music under them. Neither became a silence suggestion; only 3 shorter ones did.
8. **A caption line of one orphan word** («فيه») at a cut: greedy chunking leaves the last word alone.

**Do:**
1. Shrink the MCP `edit` schema.
   - Drop `restore_project` from the MCP-exposed op union (the server keeps it for checkpoints).
   - Make sure shared sub-schemas are referenced once, not repeated.
   - Measure the tools/list payload before and after, and put the numbers in the Report.
2. `render_preflight` returns `ready`, `rev`, blockers and warnings, plus resource counts by kind. It lists only resources that are not `ready`, unless `verbose:true`.
3. `media_import` returns the analysis job id. With `wait` (≤50 s) it waits like `analyze` does.
4. MCP placement without hidden clips:
   - `add_clip` accepts `clip.trackId` as a track **kind** (`'overlay' | 'audio' | 'text'`) or a track id with `free:true`. Either routes through `freeTrackFor`: preferred track if free, else the nearest compatible one, else a new track (added in the same batch).
   - `move` gets the same `free:true`.
   - The `edit` result lists, in one short line each, any overlap the batch created on a free track. It names the clips and suggests `free:true`.
   - Document it in the tool description and both skill copies. Don't change the permissive default.
5. `cut_words`:
   - The pad is clamped so the kept audio never includes any part of a cut word.
   - When the cut leaves a pause of more than 0.6 s across it, the cut also takes that pause down to the normal breath (0.12 s). Tell the caller in the result.
   - Tests in `packages/shared/test`.
6. When a transcript exists, word gaps over 0.6 s that energy detection missed also become `silence` suggestions, using the same breath padding and no duplicates. Python `analyze.py` or the server summary step, whichever owns suggestions now. Test it.
7. Caption chunking balances lines: no line of a single word when the neighbour can take it within `maxWords + 2`. Prefer breaking at punctuation and pauses. Linked captions (Task 13) must keep their word links. Test it.

**Done when:**
- The MCP smoke (`scripts/check-project-mcp.mjs`) covers: import job id, free placement, the slim preflight, and `cut_words` with adjacent words.
- On a temporary project with speech (make one with ffmpeg from any wav plus `testsrc2`; no user project), the same flow as above leaves `check_cuts` with no «inside a word» warning for adjacent-word cuts.
- tools/list size is reported before and after.
- Tests, typecheck and build pass.

---

## Task 16 — Export and performance: graphics cache, render speed (after Task 15)

**User priority (2026-11-07):** export and performance, large projects.

**Found by Claude:**
- The user's «تشويقة» is 7.3 GB, but its footage is 27 MB. **6.9 GB is `cache/graphics`**: two `.mov` files of 3.6 GB each, for two full-screen HTML graphics of 64 s at 1080×1920.
- `packages/server/src/graphics.ts` `renderOne` stores every frame as lossless PNG in MOV (`-c:v png` / `copy`).
- The cache key changes on any data or edit change. Old entries are never removed, so each tweak of a long graphic leaves another few GB behind.
- Every frame is a fresh headless screenshot, even while the graphic is holding still. With motion blur (`motionBlur` default 4 on final renders) that is 4× the screenshots.
- For reference: night-qa (62 s, no graphics) renders preview in 21 s and final in 16 s, so plain footage is fine. Graphics are the problem.

**Do:**
1. **Smaller graphic layers.**
   - Measure on a real long graphic: copy a graphic folder and its data into a temporary project. Never touch the user's projects; reading their `graphics/` to copy is fine.
   - Compare the current PNG-MOV with alpha codecs the bundled ffmpeg has, e.g. FFV1 `rgba`, ProRes 4444 (`prores_ks` `yuva444p10le`), and VP9 `yuva420p` for preview only.
   - Compare size, capture plus encode time, decode speed in the final pass, and quality against PNG (PSNR/SSIM on colour and alpha).
   - Pick the default that is visually lossless and at least 5× smaller. Preview renders may use a lighter one.
   - Bump the cache `VERSION`, so old entries are simply not reused.
2. **Don't capture what doesn't move.** When consecutive captured frames are byte-identical (hash the PNG), stop paying for the encode of each copy where the codec allows it. More important: find a cheap signal that the page is idle between two times (no running CSS/WAAPI/GSAP animation; `GRAPHIC_RUNTIME` already controls them), and reuse the last frame without a new screenshot. Must stay frame-exact against the current output: prove it with a pixel comparison on a library template and on one of the user-style long graphics.
3. **Cache cleanup.**
   - After a successful render and on server start, remove `cache/graphics` and `cache/segments` entries that the current project does not use and that were not used in the last 24 h. Use the file's last-use time; touch entries when used.
   - Also cap each project's cache, for example 3 GB, oldest first. Keep the cap in one constant.
   - Never touch `source/`, `renders/`, `analysis/` or anything outside `cache/`, and never follow links. Jobs running for that project defer the cleanup.
   - The editor shows the project's cache size somewhere sensible (project settings or export dialog), with «تنظيف الملفات المؤقتة».
   - Report how big «تشويقة» would be after cleanup, as a dry run on its file list only. Delete nothing in user projects during QA.
4. **Faster graphic capture.**
   - Measure where a final render's time goes: graphics capture, segments, final pass.
   - If capture dominates, capture a long graphic with 2–4 pages in parallel (split by time range, then join), bounded by CPU count. Seeking is time-driven, so ranges are independent.
   - Report before/after times on the same temporary project.
5. **Tests:** cache key/version, cleanup selection (used / recent / cap / never outside cache), idle-frame reuse stays pixel-identical.

**Done when:**
- A temporary project with a 64 s full-screen 9:16 graphic plus footage exports correctly, with frame-exact or visually identical output (numbers in the Report), and its graphics cache is at least 5× smaller than now.
- The capture time is reported before and after.
- Cleanup removes stale entries and never anything else.
- Tests, typecheck and build pass.

---

## Task 17 — Edit review: catch what a viewer would notice, before export (after Task 16)

**Why:** Claude edits through MCP and can only check its work piece by piece: `check_cuts` for cuts, `contact_sheet` to look, and preflight for missing files. Nothing checks the edit as a whole for what a viewer would notice. The project vision lists automated continuity checks as still open. Make one shared review that the export dialog and Claude both use.

**Do:**
1. **A shared, pure review** in `packages/shared/src/` (e.g. `editReview(project, ctx)`). It returns findings with `{code, severity: 'warn'|'info', at (timeline s), end?, clipIds, message (Arabic, short), fix? (an op hint for Claude)}`. Cheap checks that need no rendering:
   - **Flash frames:** a visible clip, or a V1 piece between two cuts, shorter than about 0.25 s (unless it is a deliberate freeze or transition).
   - **Text on screen too briefly to read:** compare words against duration, about 3 words/s, Arabic included; captions are exempt when linked to speech.
   - **Text collisions:** two text layers, or text and a graphic, visible at the same time in the same screen band. Use `y` and preset heights; e.g. a lower third over the captions at y≈0.86.
   - **9:16 safe area:** text or graphic boxes inside the bottom ~20% or right ~12% where Shorts/Reels/TikTok put their buttons. Only when the aspect or export is 9:16.
   - **Black picture:** time where nothing visible covers an absent V1. Info only when intended, e.g. the start of a podcast.
   - **Music under speech:** a music clip with volume above about 0.6 while speech plays and ducking can't bring it down enough. Use the same numbers as the render's ducking.
   - **Abrupt audio:** a music/voice clip that starts or ends mid-timeline with no fade, and is not at a cut of V1.
   - **Jump-cut runs:** more than 3 consecutive same-shot V1 cuts within 10 s with no zoom/transform change. Info, with the skill's tip (1.08–1.15 zoom on alternating pieces).
   - **Leftovers:** open comments, pending suggestions or ideas, overlaps on free tracks (from Task 14), and caption overlaps (Task 13). Reuse the existing checks; don't duplicate them.
2. **MCP tool `review`** `{project, max?}`: the findings, most important first, one line each with timeline time and the fix hint. Add the summary counts to `render_preflight` warnings, so a render shows them without another call. Update the skill's gates: run `review` after `check_cuts` and before the preview render. Update both skill copies.
3. **Editor:**
   - The export dialog shows the review findings (collapsed, with counts) next to the existing preflight warnings. Clicking one seeks the timeline and selects its clips.
   - Findings never block export.
   - Optional: a small badge on the export button when there are warnings.
4. **Tests** in `packages/shared/test`: one positive and one negative case per check, Arabic text reading speed included.

**Done when:** on a temporary project built to trip each check (and on night-qa), `review` lists each one with the right times, and the export dialog shows them and seeks on click. A clean temporary edit gives no warnings. Tests, typecheck and build pass. No user project changes.

---

## Task 18 — Desktop build of tonight's work (last task of the night)

**Do:**
- Rebuild the Windows installer with Tasks 14–17 (`npm run dist:win`) and bump the patch version once.
- Then repeat Task 12's packaged smoke on an isolated data root with a clean PATH:
  - start, single instance, import a video, place b-roll, add a title;
  - export an MP4 with a graphic (Task 16's cache codec inside the package);
  - run `review`, and the bundled MCP smoke against the running app;
  - close.
- Report the installer path, size, SHA-256 and anything that differs from dev.
- Don't touch the user's installed copy or the user's Documents\Qassa data.

---

## Task 19 — Smooth preview on heavy projects — closed by measurement (no work)

Claude measured it on 2026-11-07 in headed Chrome with the GPU, on an isolated copy of «تشويقة» (two full-screen 64 s graphics over voice):
- Playback over graphic 1 and graphic 2, 8 s each: about 199 rAF frames/s, 0 frames over 25 ms, p95 5.1 ms, max 15 ms, no long tasks, playhead drift ≤ 0.03 s. The graphic iframe was visible and animating.
- Script: `artifacts/qa/claude-t19/measure.mjs`.
- No change needed on this machine. Reopen only if the user reports stutter, and measure on their machine first.

---

## Task 20 — Faster graphic capture (sol, from 07:10)

**Measured tonight (Claude and sol, Task 16):**
- A 64 s full-screen 9:16 graphic still takes about 460 s to capture and encode (328 s of it is capture, 1920 screenshots).
- A 6 s library graphic in a 1080p final render with motion blur 4: capture 12.0 s on 2 pages, 12.7 s on 4 pages. More pages do not help, so the bottleneck is per-screenshot cost inside Chrome (seek + layout/paint + PNG encode with alpha), not parallelism.
- `optimizeForSpeed` PNG is used only for opaque pages; alpha pages take the slow path (`graphics.ts` `renderOne` → `shot`).

**Do (measure each step on the same two fixtures: the 64 s user-style graphic copied into a temporary project, and `lib/chapter` 6 s with motion blur 4):**
1. Profile one screenshot: how long are seek (runtime pause/seek of CSS/WAAPI/GSAP), layout/paint, the capture itself, the PNG encode, and the transfer to Node?
2. Try, keeping only what is faster **and** pixel-identical (or within the Task 16 quality bar on composited output):
   - CDP `Page.captureScreenshot` with `optimizeForSpeed` on alpha pages, verifying the alpha;
   - `HeadlessExperimental.beginFrame` deterministic frames (`--enable-begin-frame-control`), screenshot as part of the frame;
   - raw RGBA readback (e.g. a canvas/`captureBeyondViewport:false` path or `Page.startScreencast`, only if it keeps alpha) piped straight into ffmpeg as `rawvideo`, skipping PNG encode/decode;
   - a smaller viewport scale for preview-quality renders only.
3. Motion blur: for samples where the page is idle between the first and last sub-frame, reuse the frame for all samples. Partly done already; check the coverage.
4. Report a table: before/after seconds per screenshot and total for both fixtures, plus quality numbers. Keep the old path behind a fallback if the new one fails on a page.

**Already done by Claude (05:00–05:54, commit `4018b84`). Read this first:**
- Measured on 16 s of the «تشويقة» graphic (isolated copy): about 160 ms per screenshot, almost all of it painting the frame. Seeking costs 0.6 ms.
- Pages of one Chrome process do not paint in parallel: 1, 2 or 4 pages all gave 77 s of capture. Now every worker after the first launches its own browser (`launchBrowser()` in textimg.ts): capture 76 s → 33 s with 4 workers, whole graphic 141 s → 73 s.
- Fast PNG for pages with alpha too: decoded RGBA identical on 3 templates and both user graphics; about 1.5× per shot on templates, little on heavy pages.
- Each worker paints 3 throwaway frames before its range. This user graphic draws from previously painted frames: a fresh page differed for 2 frames, and seeking alone did not fix that.
- Determinism: library templates give the same frame digest with 1, 2 and 4 workers. On the user graphic, alpha is identical, but the PNG digest still differs between 1 and N workers. Colour MSE ≤ 0.5/255, invisible; same as with Task 16's page split. Not solved.
- An earlier comparison claiming 4× from fast PNG was biased (the paint was counted in the first screenshot); ignore it.

**Left for sol:**
1. Find the remaining split difference on the user graphic, using per-frame PNG hashes, and make 1 vs N workers byte-identical if feasible.
2. Encode is now a big share: 64 s for 480 frames on one part. Look at x264 preset/threads for the 4:4:4 colour stream, keeping the quality bar.
3. Per-screenshot paint cost on heavy pages: try `HeadlessExperimental.beginFrame` or raw RGBA readback.

**Done when:**
- The 64 s graphic captures at least 2× faster with an identical or visually lossless composite.
- The library template stays frame-exact.
- Tests, typecheck and build pass.

---

## Task 21 — Full audit as a new user (sol, after Task 20)

The user's last priority for the night: use Qassa the way a first-time creator would, find what breaks or confuses, and fix what is clearly a bug.

**Setup:** isolated `EDIT_DATA_DIR` under `artifacts/qa/task21/`, your own server/Vite ports (43xx/51xx), headed or headless Chrome. Footage: generate it with ffmpeg, or copy files read-only out of user projects. Never write to user projects, 4317 or 5173.

**Walk through, as a new user, and screenshot each step:**
1. Home: create a project (each start: video, podcast, empty), rename it, open it.
2. Import: drag several files at once (video, audio, image), watch the analysis progress, play the result.
3. Build a short edit with only the UI: trim, split, ripple delete, move between tracks, add a title, add a library graphic and edit its text, add music, set volume and fades, undo/redo across all of it.
4. Notes and marks: add a comment, set In/Out, export only the marked range.
5. Styles and brand: apply a style, open the brand kit window.
6. Export: preflight, the «مراجعة المونتاج» list, a final export, opening the result.
7. Keyboard: the main shortcuts on an Arabic layout (physical keys), and the shortcut editor.
8. 9:16 project: the same basics, and check the unsafe area finding.
Also check RTL in each panel, empty states, error messages (bad file, missing media), and whether each step is discoverable without docs.

**Do:**
- Fix clear bugs and small UX gaps directly, each with a test where it fits. Keep fixes small and separate.
- Anything that is a product decision (layout change, new feature, removing something) goes in the report as a proposal for the user. Do not build it.
- Report: a findings table (step, what happened, severity, fixed / proposed), screenshots in `artifacts/qa/task21/`.

**Done when:** every step above is walked through, clear bugs are fixed with tests, and `npm test`, `npm run typecheck` and the app build pass.

---

## UX plan (2026-11-07 evening) — Tasks 22–25: an editor a first-time user gets without help

The user asked: make the platform easier to use; sol builds it. Claude walked through the web editor as a new user on an isolated server (4391/5191, `artifacts/qa/claude-1107/ux1-walk.mjs`, `ux3-flows.mjs`, `ux4-text.mjs`; screenshots `artifacts/qa/claude-1107/ux-*.png`). The editor works with no page errors. These tasks fix what made it hard to follow. Do them in order, one per run, as in **How to work**. Each one needs before/after screenshots at 1600×1000 **and** 1366×768 in `artifacts/qa/task<N>/`.

Starting point: commit `664f3fd`. `styles/favorites.json` and `styles/recent.json` are the user's own data and stay uncommitted. Leave them as they are.

---

## Task 22 — Small things a new user trips over (first)

What Claude saw:

1. **A new title can't be seen.** «نص» in the timeline toolbar (`Timeline.tsx:508`), the inspector button (`Inspector.tsx:687`) and the shortcut (`App.tsx:270`) each add a text with different defaults. The text starts at the playhead with `slide-up`, so on the paused frame it is still invisible (`ux-16-text-later.png`). It is not selected, and the right panel stays on the assistant. Its 4 s also ran past a 3 s video, so the project got 1 s of black at the end.
2. **A gold bar lights up between tracks on plain hover** (`.track-insert-zone:hover`, `index.css:706`; `ux-03-editor-empty.png`). It is 8 px and sits above the clips (z-index 50), so it also takes clicks meant for the top and bottom edges of a clip.
3. **Two magnet buttons with the same icon** next to each other: «الأساسي» (main-track magnet) and the snapping magnet (N) with no text (`Timeline.tsx:512–514`).
4. **The music track head says «موسيقى» twice**: the name, then the voice/music toggle (`Timeline.tsx:709`).
5. **The empty viewer** still says «أفلت مقطعك هنا» after media was imported but nothing was placed. It also offers the فيديو / صوت / فارغ starts again, although Home already asked for one (`Viewer.tsx:~442`).
6. **Timeline toolbar buttons don't show their shortcut**, for example «نص», «تقسيم», «حذف المحدد», «إضافة تعليق». The shortcuts live in `lib/keys.ts`, and the tooltips should read from there (they are rebindable).

Do:
- One shared helper for «add a title at the playhead», used by all three entry points. When it runs:
  - Select the new clip and open the text properties with the text ready to type.
  - Shorten the duration so it ends where the content ends, when there is content after the playhead (minimum 1 s). With no content, keep 4 s.
  - The paused preview must show it straight away. Suggested: while paused, a selected text whose entrance animation covers the playhead is drawn in its settled state. Playback and export stay unchanged.
- Show the insert zone only while something is being dragged (media, clip or track). Plain hover shows nothing, and the zone doesn't catch clicks.
- Give the snapping magnet a short label, «التصاق», and make the two buttons tell apart at a glance.
- Track head: show the voice/music toggle as a small chip that says what it does («ينخفض تحت الكلام» / «كلام»). Don't repeat the name.
- Empty viewer:
  - No media: one line «أضف ملفاتك» with the import button.
  - Media but nothing placed: «اسحب من المكتبة للتايملاين، أو اضغط ＋ على الملف» and a button **«ضع الكل على التايملاين»**. The button places the library's videos/images in library order on V1 as one undo step, through the existing placement path.
  - Remove the start buttons from the viewer.
- Tooltips with the current shortcut on the timeline toolbar and the viewer transport, read from `keys.ts`.

**Done when:**
- A new title is visible, selected and editable straight after you press «نص».
- No gold bar appears without a drag.
- Tests cover the shared title helper (duration clamp) and «ضع الكل» as one undo step.
- `npm test`, `npm run typecheck` and the app build pass.

---

## Task 23 — Export: simple first, details on request (after Task 22)

What Claude saw (`ux-08-export.png`):
- The dialog shows seven presets and then every setting at once: name, format, aspect, resolution, fps, quality, codec, range, details.
- Readiness sits at the bottom, below the fold.
- «صوت فقط» sits alone on its own row.

Do:
- **Default view:** the presets, the file name, «الجزء المصدَّر» (whole edit / marked part), the readiness line and «ابدأ التصدير».
- **«إعدادات متقدمة»:** a closed section holding format, aspect, resolution, fps, quality and codec. It opens by itself when the user's last export changed one of them; remember that per viewer.
- Show a one-line summary of the chosen output next to the button, e.g. «يوتيوب · 1920×1080 · 30fps · ~3 ث». Move readiness up next to it.
- Lay out the preset grid so no tile sits alone; audio can be a smaller tile or a row.
- Don't change the export contract, preflight or the review list. Only the dialog layout changes.

**Done when:**
- At 1366×768, a default export takes no scrolling: preset → name → start.
- Advanced settings still reach every option, and an export with them gives the same file as before (compare ffprobe output).

---

## Task 24 — Words a beginner understands, and a first-run guide (after Task 23)

What Claude saw:
- Jargon in the timeline:
  - «حدود التصدير» in the ruler corner, and «اسحب I / O لتحديد التصدير» (`Timeline.tsx:527, 547`).
  - «بي-رول».
  - «ملاءمة».
  - «زوم وتركيز» with «◎ النقطة» and «◆ مفتاح».
  - The position buttons in the inspector are bare arrows (↖ ↗ ↙ ↘ كامل وسط).
- The assistant panel opens by default and, right after the first import, adds a long «أفكار بصرية» card and a transcription prompt (`ux-13-text.png`) before the user has done anything.

Do:
- Rename for a creator, keeping the meaning and the tooltips:
  - «حدود التصدير» → «جزء التصدير»; the hint becomes «اسحب المقبضين لتصدير جزء فقط».
  - «بي-رول» → «لقطات فوقية». Change the default track name for new projects only; existing projects keep theirs.
  - «ملاءمة» → «ملاءمة الكل».
  - «◆ مفتاح» → «◆ حركة» (tooltip: «أضف نقطة حركة عند المؤشر»).
  - The position arrows → a 3×3 grid of small boxes with a tooltip on each, e.g. «أعلى اليمين».
  - Keep RTL in mind: right is the start.
- **Assistant panel:** «أفكار بصرية» and the transcription offer shrink to one line each, with a «اعرض» button. The request box comes first. Nothing changes for projects that already have ideas.
- **First-run guide:** a short checklist inside the editor, shown once per viewer, dismissable, stored with localStorage in try/catch:
  1. أضف ملفاتك
  2. ضعها على التايملاين
  3. قص أو أضف نص
  4. صدّر
  - Each step ticks itself from project state (media exists / a clip exists / an edit op happened / an export finished).
  - Each step has a «وريني» button that points at the control (flash its outline).
  - Settings has «أعد عرض دليل البداية».
- Also from the Task 23 review: the export dialog says «من العلامات I/O» above the range fields. Use the same words as the timeline («جزء التصدير»), with no I/O.
- Update the skill docs only if a name the MCP tools use changes. They shouldn't: these are UI labels.

**Done when:**
- A fresh viewer sees the checklist, it ticks through the four steps in a real walk, and it never comes back after closing.
- All renamed labels are checked at 1366×768 RTL.
- Tests pass.

---

## Task 25 — Laptop screens (after Task 24)

What Claude saw at 1280×720 (`ux-10-small.png`):
- The media library is gone, with nothing saying where it went.
- The viewer is about 240 px high.
- The timeline shows only 3 tracks, with no visible way to give it more room.

Do:
- Check 1280×720, 1366×768 and 1536×864 (Windows 125% scaling of 1920×1080).
- When a panel hides because of width, show a visible tab/button where it was («مكتبة المشروع») that opens it as an overlay.
- Give the viewer/timeline split a visible grip. Remember the split per viewer, the same way the timeline height is saved today.
- Toolbars wrap or collapse into «⋯»; no button is cut off or hidden behind another.
- Text and buttons keep at least the design system's minimum sizes.
- From the Task 24 review: the start guide takes a full row above the workspace (about 60 px at 1366×768). On short screens, make it one slim line, or fold it into a button in the header that shows the progress («2/4»).

**Done when:**
- At each size, every panel can be reached with the mouse and the three main steps (import, edit, export) work.
- Screenshots at all three sizes are in `artifacts/qa/task25/`.

---

## Practical plan (2026-11-16) — Tasks 26–32: fast daily work for someone who knows the editor

The user now edits real videos in Qassa: Claude makes the first cut through MCP, then the user adjusts by hand in the editor. The user's words: the program is «غير عملي أبدا» in working and exporting. Asked what exactly, the user picked all of these:

- the timeline and cutting (too many steps, surprising behaviour),
- slowness and freezes,
- working with Claude (slow, costly, or needs a lot of fixing by hand),
- a crowded interface (tools are hard to find fast, too many panels and clicks),
- export: too many steps. The user wants one button and the file comes out.

Tasks 22–25 were for a first-time user (wording, a guide). These tasks are different: they are about **speed for a daily user**. The measure is clicks and seconds of waiting per operation, not looks. The user chose «measure, then fix»: Task 26 measures and fixes nothing; every later task repeats the same measurement and reports before/after numbers.

Starting point: commit `307128e`. `styles/favorites.json` and `styles/recent.json` are the user's own data and stay uncommitted. Do the tasks in order, one per run, as in **How to work**. Evidence goes in `artifacts/qa/task<N>/`.

Claude reviews Task 26's findings and may rewrite Tasks 28–31 from them before you start those. Read each task again when you start it.

---

## Task 26 — Measure a real edit from import to export (first; fix nothing)

Set up an isolated server (ports other than 4317/5173, isolated `EDIT_DATA_DIR`) with two projects:

- **Light:** one short clip (about 1 min), a title, one overlay.
- **Heavy:** a synthetic project built from sample footage: about 10 min, 150+ clips on V1, 4 tracks with overlays, music and 100+ captions, and 3 HTML graphics from `graphics-lib/`. The user's real projects are small (the largest `project.json` is «تشويقة»), so also copy «تشويقة» into the isolated data dir as a real case. Copy only; the original is read-only for you.

Drive the real editor in Chrome (puppeteer-core) and keep the scripts, so later tasks can rerun them: `artifacts/qa/task26/measure-*.mjs`, each printing JSON.

Measure, for the light and the heavy project:

1. **Export.** From clicking «تصدير» to the file shown in its folder: clicks, seconds waiting for preflight, render seconds per minute of video (first export and a repeat with warm caches), and clicks after the render ends. Also «صدّر المحدد» for a marked part.
2. **Timeline operations.** For each one, count the clicks/keys and the time from input to the screen showing the result:
   - split at the playhead, delete a section (ripple), move a clip on V1, move a free clip to another track, trim an edge, trim to the playhead,
   - add a title, put a b-roll clip over a section, change a clip's volume, mute a track, undo/redo,
   - select several clips and delete them, zoom the timeline in/out and find a place in a 10 min edit.
   Write down every surprise: nothing happens, the wrong clip moves, a silent refusal, a selection that is lost.
3. **Speed.** Project open time; time per op (request sent → store updated → painted); preview frame rate while playing and while scrubbing; dropped frames while dragging a clip. Record a Chrome performance profile for each freeze over 200 ms and name its cause (function or component).
4. **Working with Claude.**
   - From the existing `projects/*/ai-tasks.jsonl` (read-only, no new spending): duration, tokens and cost per kind of request and tier.
   - Through MCP (`scripts/check-project-mcp.mjs` shows how): the number of tool calls and seconds for a standard brief on the light project («cut the silences, add a title and captions, export»). No paid `claude -p` run is needed for this; you call the tools yourself.
   - In the editor: what the user sees while an AI task runs, and how many clicks it takes to see what changed and to undo all of it.
5. **Clutter.** Count the visible controls in the header, the rail, the timeline toolbar, the transport, each inspector tab and the assistant panel, at 1600×1000 and 1366×768. Mark which ones the daily path in points 1–2 used.

Write `docs/research/practical-2026-11.md`:
- one table per point above (operation, clicks, seconds, what gets in the way),
- **the 15 worst points, ranked by time lost per edit session**, each with its cause in the code (`file:line`) and a proposed fix in one or two lines,
- anything broken that you met on the way (a bug list, separate from the slow points).

Don't fix anything in this task, not even small things. Put them in the list.

**Done when:**
- `docs/research/practical-2026-11.md` has the five tables with real numbers for both projects, and the ranked 15.
- The measuring scripts rerun with one command each and print the same numbers (±10%).
- The isolated data dir is deleted, and `git status` shows only the new doc, the Report line and `docs/IMPROVEMENTS.md`.

---

> **Rewritten by Claude on 2026-11-16 from Task 26's findings** (`docs/research/practical-2026-11.md`). What changed:
> - Timeline edits are already optimistic and paint in under 35 ms on the heavy project (`store.ts:371`), and no freeze over 200 ms appeared after loading. So the old «optimistic updates» and «no freezes» work is dropped. What the measurement did find: an export that fails, a slow marked export, a drop that vanishes, a seek that goes off screen, long and costly AI requests.
> - The measurement used one 640×360 source in headless Chrome. The user edits real camera and screen footage, so Task 30 repeats the speed measurement on real-size footage before anything is called fast.
> - The ±10% repeat rule is relaxed: compare medians of three runs in the same cache state, and report the range.

### Night run 2026-11-16 (the user is asleep; these rules replace rules 4 and 9 for tonight only)

- Do Tasks 27 → 32 in order in one run, without waiting for Claude between them. Read each task again when you start it.
- **One local commit per finished task**, on `master`, so Claude can review each task alone in the morning. Message: `Task <N> (sol): <what changed>`. Commit only the files of that task. Never commit `styles/favorites.json` or `styles/recent.json`. Never push, and never rewrite history.
- A task is finished only when its «Done when» list holds and `npm test`, `npm run typecheck` and the app build pass. Write its Report entry and its `docs/IMPROVEMENTS.md` entry before the commit, in the same commit.
- If a task is blocked, or a «Done when» line can't be met: commit what works and passes the checks, write exactly what is missing under Report, and go on to the next task. Don't leave the tree broken, and don't spend more than about two hours on one task.
- A product decision you are unsure about: take the option that changes less, and write the question under Report.
- No one will answer questions tonight. Nothing destructive, no user projects, no ports 4317/5173, as always.
- When all tasks are done, or you must stop, finish with a short «Night summary» under Report: per task done / partly / not started, and what Claude must look at first.

---

## Task 27 — Exports never fail, and a short part exports fast (after Task 26)

From Task 26's bug list and export table:

1. **`spawn ENAMETOOLONG`.** A timeline with about 120 animated text layers fails in the final pass, in full and marked exports. The filtergraph goes to ffmpeg as a command-line argument (`packages/render/src/run.ts:40`; per-text filters are built at `compile.ts:598`), and Windows refuses the long command. This is a real export a user can make: an animated caption per sentence in a 10 min video.
2. **A 5 s marked part of the heavy project takes 33.6 s.** The compiler builds the whole timeline and applies the range late (`compile.ts:654`).

Do:
- Pass the filtergraph through a file (`-filter_complex_script`, or `-/filter_complex` on the bundled ffmpeg version; check which one it supports) whenever it is long, written inside the project's `cache/` with a project-relative path (cwd stays the project folder). If the input count is the limit too, compose in bounded passes. Reproduce first with `artifacts/qa/task26/measure-compile.mjs`.
- Marked export: drop the clips, texts and graphics that lie fully outside the range before preparing them, so only what the range shows is captured and composed. The output must be the same frames and sound as the same range cut from a full export.
- Add compiler tests: a project with 150 animated texts compiles to a command under the Windows limit; a ranged compile only references clips that touch the range.

**Done when:**
- The 120-animated-text heavy variant exports cold, warm and marked, and ffprobe shows the right duration and frame count.
- The heavy 5 s marked export takes under 10 s warm (it was 33.6 s). Report cold and warm medians.
- A marked export and the same range of a full export match (frame hashes at 5 sampled frames, and audio duration).
- Full exports of the light and heavy baselines are not slower than in Task 26 (medians).
- `npm test`, `npm run typecheck` and the app build pass.

---

## Task 28 — Export with one click (after Task 27)

What Task 26 measured: a repeat export is 2 clicks, a preflight wait, then 1 click to reveal. When the user closes the dialog to keep working, it is 5 clicks, with 2 of them after the render ends, and nothing tells the user it finished. The file name falls back to the project name each time the dialog opens (`ExportDialog.tsx:29` strips the saved name), so a «مراجعة» export loses its suffix.

Do:
- **Split button in the header** (`Header.tsx:71`). The main part «تصدير» exports straight away with the project's last export settings (`qassa.export.<name>`). A small arrow beside it opens the dialog as today. A project with no saved export settings opens the dialog the first time.
- **Preflight in the background.** The quick export runs the same preflight and the same `canSubmitExport` / `startRender` path. A blocker opens the dialog on the blockers. Warnings and review findings don't stop it; show their count in the finished notice, and a click opens the dialog on them.
- **Progress where the user looks.** While a render runs, the header button shows the percentage. The user keeps editing; the export is of the snapshot, as today.
- **A finished notice** (design-system toast; stays until dismissed or the next export): file name, duration, «تشغيل», «إظهار في المجلد». A failed export shows the error and «افتح التفاصيل».
- **Marked part:** when the project has In/Out marks, the arrow menu offers «صدّر المحدد» as one click (`render marked:true` path).
- **File names:** keep the preset suffix when the dialog reopens with a remembered preset. A name the user typed is remembered for that project. Quick export never overwrites an earlier file: same rule as today's versions.
- **Shortcuts** in `lib/keys.ts` with behaviour in `runAction`: quick export, and open the export dialog. They appear in the command search.
- Don't change the export contract, the preflight, the review list or the file output.

**Done when:**
- The second export of a project is one click (or one key), and the file opens from the notice with one more click, with the dialog never opened. Before/after click counts from `measure-export.mjs`.
- A blocker still stops the export and shows why. A stale revision still asks for a recheck.
- The exported file is the same as before the change (ffprobe, same project and settings).
- Tests cover «which settings and name does quick export use» and the first-time fallback.

---

## Task 29 — Timeline: the four things that got in the way (after Task 28)

From Task 26's surprises. Speed is fine here; these are about the hand.

1. **A library clip dropped exactly on the playhead vanishes**: no clip, no message (6 of 6 trials). The playhead line takes pointer events (`Timeline.tsx:851`), so the hit test at `Timeline.tsx:465` finds no track row. People aim at the playhead on purpose.
2. **Typing a time in the clock while zoomed in leaves the playhead off screen** (`Viewer.tsx:638`; the scroll-follow at `Timeline.tsx:287` only runs while playing).
3. **Clicking a clip under the playhead line scrubs instead of selecting** (the 9 px strip).
4. **Volume is 4 actions the first time**: select → الخصائص → الصوت → slider (`Inspector.tsx:88`, `:167`).

Do:
- During a media or clip drag, resolve the track from the row geometry at the pointer, so the playhead never blocks a drop. Landing box and snapping work there too. Keep scrubbing by the playhead head and line when nothing is being dragged.
- Any explicit jump while paused (clock entry, a review finding, a comment, a command) scrolls the timeline so the playhead is in view, with some margin. Ordinary scrubbing and dragging don't move the view.
- A plain click on a clip selects it even under the playhead line. The line scrubs on drag only; a click without movement goes to what is under it.
- Volume without opening a panel: a volume control in the clip menu, and two rebindable keys in `keys.ts` + `runAction` (louder / quieter by 1 dB for the selection, one undo per burst). The inspector stays as it is.
- Look for the same silent-nothing pattern in other drops (onto a locked track, onto the ruler, between rows) and give each one a one-line reason near the pointer.

**Done when:**
- The playhead drop succeeds 3 of 3 on both fixtures (`measure-editor.mjs` / `measure-placement.mjs` playhead trial).
- At 40 px/s, a clock jump to 8:30 on the heavy project shows the playhead in view (`measure-navigation.mjs`).
- A click on a clip under the playhead selects it; dragging the line still scrubs.
- Volume takes one key, or two clicks from the clip menu.
- Tests for any new op or helper. No timeline operation in Task 26's table got slower (medians).

---

## Task 30 — Speed on real-size footage (after Task 29)

Task 26 found the editor fast, but on a 640×360 source in headless Chrome. The user says the editor feels slow and hangs, and edits real footage: 1080p and 4K camera files, long screen recordings, several source files, on the dev servers started by `Start-Qassa.bat`. Measure that before fixing anything.

Do:
- Make real-size fixtures with ffmpeg (no user files): 5 different sources, among them 4K/30 H.264, 1080p/60, a 20 min screen recording and a HEVC file. Import them through the editor, so proxies, peaks and thumbnails are made the normal way, and time the import until the project is fully usable.
- Rerun `measure-load.mjs` and `measure-editor.mjs` on a 10 min edit of these sources, in a headed Chrome window too (the user's case), not only headless: open, play across cuts, scrub, drag, and export at 1080p final quality.
- Check that the preview plays proxies, not originals, and that waveforms and thumbnails are not recomputed on reopen.
- Fix what crosses these lines, worst first: a main-thread task over 100 ms while editing or playing; playback under the project's frame rate; a wait over 1 s with nothing on screen saying why. Also defer the first-load WebGL setup that Task 26 profiled at 296 ms (`glgrade.ts:135`, `Viewer.tsx:121`) and the forced layout in `Timeline.tsx:241`.
- If everything is inside the lines, say so with the numbers and fix only the first-load task. Don't invent work.

**Done when:**
- The Report has the real-size table (import, open, play, scrub, drag, export) for headless and headed, before and after.
- No main-thread task over 100 ms in the measured path after loading, or the Report names what remains and why.
- 1080p final export time per minute is reported, with the slowest stage named.

---

## Task 31 — Working with Claude: cheaper requests, one undo (after Task 30)

From Task 26 point 4:
- Old deep requests ran 5.5–8.4 min and cost about $2 each (graphics and cuts). Cache-read tokens are in the millions per request: each turn rereads a large context.
- The running card already shows the tool steps (`agent.ts:142`), so progress is not the gap.
- A finished task shows a reply, but no list of what changed, and undoing it takes one undo per batch (3 in the standard brief).

Do:
- **One undo per task.** Mark the task's edits with a task boundary so «تراجع عن كل ما سوّاه» on the finished card restores the project to before the task in one step. The user's own edits made while the task ran must survive, or the button says it can't and why. Tests.
- **What changed.** The finished card lists the changes from the ops the task applied (cuts, new clips, moved clips, changed texts), grouped and short. A click seeks and selects.
- **Cost.** Find where the turns and the context go: log per task the number of turns, tool calls and the largest tool results (extend `ai-tasks.jsonl`). Then cut the biggest ones: smaller tool results by default (the summary before the full state), fewer round trips for common briefs, and the right tier from `router.ts`. Show the estimate before sending for deep requests («قد يأخذ ~5 دقائق»).
- Paid runs: at most 3 `claude -p` runs, on the light project. Write their cost in the Report. Compare one brief before/after; one pair is a sample, so report it as such.

**Done when:**
- Undoing a finished AI task is one click, and tests cover it with and without user edits in between.
- The finished card lists the changes, and a click goes to each.
- The per-task log has turns, tool calls and result sizes; the Report says what was cut and the measured before/after of the one compared brief.

---

## Task 32 — Less on screen in the inspector (last)

From Task 26 point 5: the header, rail, toolbar and transport are 6–12 controls each, which is fine. The crowd is in the inspector: 33 controls on a video's picture tab, 37 on a graphic's place tab, 23 on audio, 21 on SFX.

Do:
- In each inspector tab, the few controls used most stay open. The rest go into closed groups with a clear name, remembered per viewer when opened. A group that holds a changed value shows a dot, so nothing set is hidden.
- Nothing is removed, and every command stays in `runAction` and the command search.
- Follow the design system (`brand/README.md`), RTL, and the laptop rules from Task 25.

**Done when:**
- No inspector tab shows more than 15 controls by default at 1600×1000 (`measure-clutter.mjs` before/after, screenshots at 1600×1000 and 1366×768).
- A changed value inside a closed group is marked.
- No daily operation needs more clicks than after Task 29.

---

## Report

(sol: one block per task — status, files changed, tests, open questions for Claude)

### Task 1 — done
- Files: server `peaks.ts`, analysis route; app `Timeline.tsx`, `store.ts`, `keys.ts`, `App.tsx`; `server/test/peaks.test.ts`.
- On-demand streaming ffmpeg PCM, 50 Hz max-abs and numpy-compatible 99.5th percentile normalization, cached and deduplicated; live refresh. Large V1 waveform saved per viewer (Shift+W, rebindable), token colours, volume keys and fades.
- Evidence: 222 tests pass, typecheck clean, app build passes. Real Chrome on an isolated temporary root: video + music imported with analyze:false, waves appeared, volume/fades changed pixels, toggle/shortcut/persistence passed. Screenshot: C:/Users/waseem42/.codex/visualizations/2026/10/30/01a18d47-5b08-7583-bb07-aa4cf5034c5c/task1-waves.png.
- Empty analysis investigation (read-only): existing projects have empty analyzed arrays as well as empty folders. No analysis-folder deletion path found in server code. Imports with analyze:false, reference roles without peaks and SFX registration without analysis can bypass peaks; Python jobs publish analyzed only after all steps finish. No durable historical failure log proves which occurred in those projects; not claiming deletion or a specific failure. Demand generation removes that dependency.
- Environment: default sandbox blocks Node realpath; test/build/Chrome passed with reviewed escalation. Brand artifact URL unavailable; followed local tokens/components. No user project changed. No open product decision.

### Task 2 — done
- Files: `server/src/project-management.ts`, shared retention constant, `Home.tsx`, MCP tool description, both edit-tool skill copies, project-management tests.
- UUID/path/tree checks, busy jobs/requests refused, delete one or all (preflight-all), restored envelopes included. Startup and 6-hour unref timer purge only entries strictly older than 30 days; skipped unsafe/busy entries are reported.
- UI: remaining days, named irreversible confirmation and empty-all project count, 30-day hints. No permanent-delete MCP action.
- Validation: 226 tests pass including fake-date boundary, restored envelopes, busy names, both DELETE routes and symlink refusal; typecheck/build pass. Real isolated Chrome: remaining days, named delete confirmation, delete one, empty-all count and deletion passed. Screenshot: C:/Users/waseem42/.codex/visualizations/2026/10/30/01a18d47-5b08-7583-bb07-aa4cf5034c5c/task2-trash.png. No real project/trash touched. No open decision.

### Task 3 — done (paid AI invocation not exercised)
- Files: shared BrandKit/settings.brand + op/schema test; server `brands.ts`, `agent.ts`, `textimg.ts`, routes; app `BrandKits.tsx`, Inspector, token CSS; MCP brands + both skill copies; four fixtures and parser/ZIP tests.
- Reusable kits under brands/<uuid> with original, parsed data/assets. Upload MD/JSON/CSS/HTML/ZIP/SVG/PNG/JPG/WebP/PDF, capped at 32 MB. Deterministic CSS/W3C alias/flat JSON/Markdown/HTML parsing, logo discovery and @font-face mapping. ZIP paths never used as extraction destinations; file count/uncompressed-size/link checks.
- Review maps theme fields to swatches, allows colour swaps/font/direction/name, shows Arabic sample/logos/voice. Apply uses set_settings (brand + theme together), undo works. Saved kits/applied kit and folded manual controls coexist with ThemeReach. Custom fonts join the shared editor/renderer font CSS/files.
- Optional quick-tier Read-only claude extraction for sparse/image/PDF kits: displayed estimate/cap, cancel, cost log through agent.ts, reviewed output before apply. No paid model call made during verification; live image/PDF model quality remains for Claude/user to validate. PDF has no local text extraction (accepted cheaply for opt-in AI).
- Validation: 232 tests pass, typecheck/build pass; isolated Chrome CSS upload, review, palette remap, apply/undo, ZIP logo and actual bundled Arabic font renamed as custom family loaded successfully. Screenshot: C:/Users/waseem42/.codex/visualizations/2026/10/30/01a18d47-5b08-7583-bb07-aa4cf5034c5c/task3-brands.png. No user projects touched. ZIP uses existing Python stdlib; no new dependencies.

### Task 4 — done
- Files: Inspector.tsx, shortcut copy-look label, Home hero wording. Removed GradeControls/ColorSection/project and clip colour tabs, their dead callbacks. No dedicated grade menu/rail/shortcut existed; copy-look still preserves existing attributes, with a neutral label.
- Existing clip/default grades, LUT/render pipeline, styles and MCP ops remain. A graded visual shows «عليه تلوين — إزالة»; removing an inherited grade gives that clip a neutral override without changing the project's grade.
- Validation: 232 tests pass (including render/style coverage), typecheck/build pass. Isolated Chrome: no colours tab, existing default grade visible in summary, remove hides the line and preserves the project default. Screenshot: C:/Users/waseem42/.codex/visualizations/2026/10/30/01a18d47-5b08-7583-bb07-aa4cf5034c5c/task4-inspector.png. No open decision.

### Task 5 — done
- Files: shared StyleUse/stylesUsed + log_style op/test; server apply-style; MCP apply_style/style_reference; store openStyle; Inspector used list; Styles/EditingStyles badges, deep links and user reference request logging; both skill copies.
- Applying a preset/saved look logs it in the same undo batch. style_reference accepts project/what and logs through ops for Claude; user reference requests log with their comment. One entry per id, newest purpose/time replaces previous. Existing projects default to an empty list.
- Validation: 233 tests pass, typecheck/build pass. Isolated MCP client: brands list is valid tool text, apply_style logs preset+claude, two style_reference reads leave one entry with latest purpose. Real Chrome: project list, click-to-open reference, used-here badge. Screenshot: C:/Users/waseem42/.codex/visualizations/2026/10/30/01a18d47-5b08-7583-bb07-aa4cf5034c5c/task5-used-styles.png. No open decision.

### Task 6 — done
- Files: server `recent-styles.ts`, Store style_used event and route registration; app `RecentStyles.tsx`, Styles/EditingStyles, shared gallery navigation in keys.ts, token CSS; recent-history tests. CLAUDE.md/AGENTS.md maps and identity/provenance rules synchronized.
- Global styles/recent.json, newest first, capped at 50, one latest row per style/source/project. Fed by undoable log_style events and explicit detail opens. GET/POST recent plus delete-one (project-scoped) and delete-all; clearing recent never removes project provenance. Detail usage reads stylesUsed from active projects.
- «الأخيرة» is the second tab, grouped today/yesterday/this week/older with project/use-again/remove/clear and empty/unavailable states. Category chips, segmented source control, sticky search, source eyebrows, used-here/favourite badges. Library details retain preview/description/licence and add used-project history and «استخدم في المشروع» (reviewed assistant request for references). Looks also have detail/reuse views.
- Arrow navigation follows RTL grid geometry; native Enter opens and Esc closes details. IntersectionObserver detaches offscreen video sources and pauses them; images remain lazy. Desktop and 390px layouts verified without horizontal modal overflow.
- Before: C:/Users/waseem42/.codex/visualizations/2026/10/30/01a18d47-5b08-7583-bb07-aa4cf5034c5c/styles-before.png
- After: C:/Users/waseem42/.codex/visualizations/2026/10/30/01a18d47-5b08-7583-bb07-aa4cf5034c5c/styles-after.png
- Phone after: C:/Users/waseem42/.codex/visualizations/2026/10/30/01a18d47-5b08-7583-bb07-aa4cf5034c5c/styles-after-phone.png
- Final validation: 236 tests pass (28 files), typecheck and app build pass. Isolated real Chrome + MCP check passes all six task flows, including recent/reuse/clear, keyboard, sticky search, viewport-aware previews, phone layout and custom Arabic font loading. Scratch scripts: sol-qa.mjs and font-qa.mjs beside those screenshots.
- Final QA fixes: originless text-render pages could not load local file fonts (including bundled fonts). fontFaceCss now embeds only the selected render fonts as data URLs; an actual renderer-browser check proves custom font loading and a Chrome regression test protects it. HTTP previews still use font endpoints. Clearing a clip grade over a project grade now explicitly clears an old LUT too. Cost estimates keep LTR order. No paid AI call exercised (Task 3 limitation remains); no other open decision. No commits; no user projects/trash changed.

### Task 7 — done
- Files: shared import.ts + update_media op; server uploads.ts/media.ts/index.ts; app import queue/Uploads, App/MediaPanel/Timeline/Viewer, brand drop propagation; uploads.test.ts; both edit-tool skill copies.
- Role-free ordered uploads, guessed roles and auto placement (including audio spine); XHR per-file progress and cancellation, cards remain useful during analysis. Role changes never move clips. Timeline card/OS drops use nearest V1 boundary, exact overlay/audio time and new-track landing boxes. Unique upload paths preserve duplicate filenames and failed/cancelled unregistered files are cleaned up.
- Validation: 240 tests pass, typecheck/build pass; real isolated Chrome proved video+song OS drop on viewer, V2 @12, role-only mutation, new track, active+queued cancellation. Python analysis intentionally disabled in browser fixture; peak generation still ran. Home keeps explicit source uploads. Screenshot: C:/Users/waseem42/.codex/visualizations/2026/11/05/01a1ad05-1216-7eb0-9ff6-943327268e9e/task7-import.png; script sol-qa.mjs beside it.
- No real projects/trash changed, no commits. Token/component rules followed locally (brand artifact inaccessible). No open product decision.

### Task 8 — done
- Files: shared Picture.off + placement/audio validation and sound-only op test; app ClipMenu/Inspector/MediaPanel/Viewer/Timeline; render compile + compiler/real-render tests; sheets.ts; MCP docs and both skill copies.
- One-action sound-only toggle keeps V1 place/length, black under overlays; off overlays retain sound and draw nothing. Wave-only timeline, video sound on audio tracks, media menu adds sound at playhead on a free audio track. Picture settings survive toggling.
- Validation: 243 tests pass; typecheck/build pass. Real CPU MP4 exports + decoded audio/pixels and contact sheets tested for V1, overlay and audio tracks. Chrome measured audible MP4 signal (music muted), verified black main canvas and media action; Task 7 flows still pass. Screenshot: C:/Users/waseem42/.codex/visualizations/2026/11/05/01a1ad05-1216-7eb0-9ff6-943327268e9e/task8-sound-only.png; sol8-qa.mjs beside it.
- No user projects/trash touched; no commits or open decision.

### Task 9 — done
- Files: shared Track.audio/ProjectStart/defaultTracks, remove_track/move_track ops and track compatibility; shared tracks/import tests; server create/store/export-preflight; app StartChoice, Timeline track controls, dynamic Viewer/audio.ts/mix.ts, Home/store, SourceRange/source-range, GraphicPicker, EditHandles/Modal; render voice mixing and compiler/real-audio/real-pixel tests; MCP docs/create start; both skill copies and CLAUDE.md/AGENTS.md rules.
- Add overlay/text/voice tracks; rename, reorder, music/voice toggle, remove empty or confirm populated removal with a clip count. Ops are undoable; V1 stays first and cannot be removed. Text only on text tracks; video sound can move to audio or join V1. Detached/media-only voice uses a free voice track rather than the music bed.
- Voice tracks are neither auto-faded nor ducked, but drive music ducking with V1. Custom fades, volume keys and denoise still apply. Preview now supports concurrent visual layers and any number of active audio clips, pauses/disposes removed elements and follows visual/text track ordering. Sound-only overlays keep their levels and key the bed. Live RMS compressor uses the render's threshold/ratio/attack/release; it is not sample-identical to ffmpeg's compressor.
- Home and empty editor offer video/podcast/empty starts; only initial tracks differ. Empty-editor choice uses existing track ops and can be undone. Podcast/audio V1 auto-opens large waves. New text/graphics create fitting tracks when necessary; range picker uses actual overlay IDs. Audio-spine export preflight now accepts the already-supported render path; off pictures do not require visual LUTs, and hidden sound-only overlay audio dependencies are checked.
- Validation: final 253 tests pass in 36 files, typecheck clean, app build passes. Real 64px CPU exports: frequency measurements prove voice onset stays level and ducks music over a silent spine; decoded pixels prove track reordering changes overlay stacking identically in export and contact sheets. Real isolated Chrome: add/rename/type/reorder, populated remove + restore via undo, Home podcast shape, empty choice + undo, audio V1 + large-wave auto mode + export readiness, 2 simultaneous video layers and 4 simultaneous unattenuated voice tracks. Previous Task 7/8 flows pass again. Isolated MCP discovery/create/checkpoint/trash/restore smoke also passes.
- Screenshots: C:/Users/waseem42/.codex/visualizations/2026/11/05/01a1ad05-1216-7eb0-9ff6-943327268e9e/task9-tracks.png and task9-podcast.png; final scratch browser script sol9-qa.mjs in the same folder. All temporary project roots removed. Python analysis was deliberately disabled only for browser fixtures; existing analysis pipeline was not re-run or modified. No paid AI call; Task 3's prior paid-AI verification limitation remains.
- Both edit-tool skill copies match; new rules in CLAUDE.md/AGENTS.md match (their pre-existing agent names and skill paths remain distinct). No real user project/trash touched, no git commits, no open product decision.

### Task 10 — done
- Files: Viewer wall-clock fallback/empty prompt/transport-synced SFX; store/App/export dialog and project durations; render black padding; server export readiness/covers/frame preparation; media.ts default steps + analysis metadata/deduplication; Python default steps; uploads.ts UTF-8/full names/placement roles; shared speech/caption guards; Transcribe component and media/transcript/assistant/ideas/notes/inspector UI; agent/MCP transcription instructions; both skill copies and CLAUDE.md/AGENTS.md.
- Empty V1 and time outside V1 play on performance.now, with black below the other tracks. Short V1 hands off naturally, later sounds keep playing, and the export lasts to the last clip on any track. Leading/interior/trailing gaps are padded with black; transitions do not blend across a gap. Transport pauses/seeks SFX too.
- Upload/default analysis (including direct Python defaults) never requests transcribe. Silence is retained: it uses ffmpeg silencedetect energy, and can work without a transcript. Explicit transcribe requests use transcribe/silence/summary, deduplicate active jobs by media + steps, and show progress/assistant intent. Word-dependent AI prompts require telling the user and explicitly requesting missing transcripts; placing/visual work never authorizes it.
- «فرّغ الكلام» in media and transcript panel; transcript requirements in caption/cut/idea/note flows. Notes expose needsTranscript rather than pretending words exist. Captions include A2 speech/legacy sources, reject missing transcripts before clearing existing captions. Free-track transcript words can be inspected and captioned; word-based editing remains on V1 and the UI explicitly says so.
- Audio import role follows the target: V1/voice = source, ordinary/new audio track = music. Role changes still do not move clips. Multipart implementation in this installed @fastify/busboy already decodes disposition parameters as UTF-8; pinned its supported defCharset option and kept the full original filename. Real browser and server tests preserve 🎙️【302】 تيك توك.wav exactly. Historical corrupted names were not rewritten; no evidence establishes how their old bytes were lost.
- Validation: 256 tests pass in 38 files, clean typecheck, app build and isolated MCP smoke. Real CPU exports: two A2 sounds/empty V1 have black pixels, audible PCM at both slots, silence between, correct duration; late overlays survive after short V1. Real Chrome: default audio + video preparation had no transcribe step, idle audio-source project had no fake spinner, black frame/audio play and late seek/natural V1 handoff worked. An explicitly clicked button ran actual cached medium Whisper offline on synthetic speech (19 words), then UI captions and note words worked on A2. No paid AI call needed. Previous Task 7/8/9 Chrome flows still pass.
- Screenshots: C:/Users/waseem42/.codex/visualizations/2026/11/05/01a1ad05-1216-7eb0-9ff6-943327268e9e/task10-audio-only.png and task10-transcribed.png; sol10-qa.mjs beside them. Temporary roots removed; no user project/trash changed, no commits, no open decision.

### Task 11 — done
- Files: shared settings.marks/markedRange, set_marks/delete_range ops and marks.test.ts; app Timeline/selection.ts/selection.test.ts, store/App/Viewer, RangeDeleteHint, ExportDialog, keys/Shortcuts; server export-preflight/index summary and tests; MCP edit/render docs, scripts/check-project-mcp.mjs; both skill copies and CLAUDE.md/AGENTS.md.
- Persistent absolute timeline marks, reversed-pair swapping, undoable set/clear and rebindable physical I/O/Alt+I/Alt+O/Alt+X/Shift+Space. Sticky ruler brackets drag with cut/playhead/comment snapping; tinted span, outside dimming and marked duration/clear. Ruler drag sets the range; click seeks. Empty-track bands replace/add/toggle clip selection across crossed rows; Alt sets marks. Final pointer position is kept in a ref so fast releases commit the latest movement.
- Export opens directly on the marked pair with «من العلامات I/O»; ordinary unmarked export stays whole. MCP render marked:true captures marks from the checked revision, and project_summary exposes them. Shift+Space plays only the marked span. Delete prefers selected clips, otherwise ripple-deletes the marked time across all tracks, trims/splits source-mapped clips and shifts comments. First use shows a destructive hint. The UI clears marks in the same undo batch; delete_range itself leaves absolute marks fixed.
- Validation: 261 tests in 40 files pass, clean typecheck and app build. Real isolated Chrome: I at 10 / O at 25 persisted through reload; export opened filled without time entry, and ffprobe measured the actual MP4 at 15 seconds. Ruler click/drag, snapping to a comment, reversed marks, Arabic-layout I, all clear shortcuts, band replace/Shift-add/Ctrl-toggle, Alt-band, bounded playback, first-delete hint and one-step undo passed. Existing clip drag, comment preservation and sticky ruler after vertical scrolling also passed. MCP smoke checks mark ops, summary and render schema as well as the existing project/checkpoint/trash flow.
- Screenshots: C:/Users/waseem42/.codex/visualizations/2026/11/05/01a1ad05-1216-7eb0-9ff6-943327268e9e/task11-marks.png, task11-export.png and task11-band.png; sol11-qa.mjs beside them. Both skill copies match. All fixture roots removed; no user project/trash changed, no commits, no open decision.

### Task 12 — implemented; isolated desktop acceptance passed, fresh-profile installer acceptance pending
- Files: packages/desktop (Electron main, Windows Job Object supervisor, NSIS configuration); scripts/build-desktop.mjs/check-desktop-processes.mjs; root package/lock/scripts; server config and writable data consumers, runtime-setup.ts, jobs persistence, agent/runtime routes, portable fonts/ZIP parsing; MCP connection.ts; app RuntimeSettings/Header/Transcribe; Python ffmpeg environment/DLL lifetime; docs/desktop.md, both skill copies and CLAUDE.md/AGENTS.md; runtime/data-dir tests.
- Built artifacts/desktop/Qassa-Setup.exe (~201 MB), per-user, no admin, Start-menu/desktop shortcuts, data-preserving uninstall, no auto-update. Electron supplies Node; server and MCP are bundled plain JS. Data defaults to Windows Documents/Qassa; resources remain read-only. Dev defaults and npm run dev stay intact. Installer bundles pinned SHA-256-verified static FFmpeg 9.0.2 with NVENC, GPLv3 notice/LICENSE/README, FFmpeg source and built-in font licences. Public redistribution still needs corresponding source/build materials for the statically linked external libraries (documented); this local test installer was not published.
- Single instance, free loopback port, health check, atomically written .port, desktop logs and persistent job journals. A guardian Job Object owns the server subtree, including Python/ffmpeg; crashes restart up to three times with user notification and interrupted jobs recovered as failures. MCP rereads the live .port, verifies the data directory and refuses to auto-start another desktop server. Settings checks Claude and shows a copyable exact registration command; in-editor tasks use the bundled MCP/runtime and shipped instructions.
- First-run screen shows estimated size, phases and bytes, pause/resume/retry, NVIDIA detection and CPU-int8 note. Actual Python 3.11.9, pip, Whisper/OpenCV/scenedetect/numpy/CUDA libraries and all 3,087,284,237 model bytes downloaded into an isolated data root; model is pinned to upstream revision edaa852ec7e145841d8ffdb056a99866b5f0a478. Import/edit/graphics/export remain available before setup; analysis/transcription show «يحتاج إكمال التجهيز». ZIP brand import no longer needs Python.
- Validation: 265 tests in 42 files pass, clean typecheck, app build and npm run dist:win. npm run dev smoke responded with isolated data (Vite used 5174 because the user's 5173 was occupied). Actual packaged Qassa.exe with PATH containing only Windows system directories: startup, single instance, no-Claude status, setup start/pause/resume across restarts, video import, pre-setup analysis hint, library graphic rendered by Edge, MP4 export, complete setup, and actual large-v3 CUDA transcription (15 words). Closing removed .port and stopped the server. Killing the actual server during transcription restarted it, recovered the job as failed and let the same bundled MCP client follow the new port; closed-app MCP did not start a server. Dedicated tests killed both server and parent and proved real ffmpeg/Python descendants were reaped.
- Limits: did not create a fresh Windows account or run the installer under one; clean-PATH/end-to-end testing is evidence for the packaged app, not a claim of that final installer acceptance. No paid Claude call. Existing projects were not moved or modified. Open release decisions requested by this task: supply a code-signing certificate (current build unsigned); whether to offer migration of existing repository projects (must be explicit, never automatic).
- Screenshot: C:/Users/waseem42/.codex/visualizations/2026/11/05/01a1ad05-1216-7eb0-9ff6-943327268e9e/task12-setup.png. Scratch sol12-setup-qa.mjs/sol12-app-qa.mjs/sol12-recovery-qa.mjs record the actual runs. Final packaged app also passed sol12-path-qa.mjs: Arabic data paths with spaces/parentheses and the Node-free .cmd MCP launcher. Final installer is 201,254,853 bytes with a sibling .sha256 file. All temporary desktop/dev-smoke data roots were removed after validation; no user project/trash touched, no commits.

### Task 13 — done
- Files: shared Clip.words schema, captions.ts, caption-links.ts, ops.ts; caption-links.test.ts; server export-preflight and overlap test; MCP captions docs; both skill copies and CLAUDE.md/AGENTS.md.
- Generated captions store mediaId/from/to plus an optional source clipId so repeated uses of one media remain distinct. Chunks never mix different source occurrences or discontinuous word ranges. Source cuts/deletes/trims/moves/speed changes regenerate only the surviving caption pieces inside the same edit/undo; split/merge ancestry is operation-local, not a growing project history. keep_only follows every retained source piece and avoids identical duplicate captions. Word-bound captions bypass generic V1 anchoring and the generic ripple trim; hold time is bounded by source end and the next generated line.
- Text shrinks/splits when words disappear; a user-edited caption wording is preserved when only timing changes. Free-track speech works too. Plain/legacy captions without words remain independent and can be regenerated to add links; no attempt to guess historical word ownership. Missing transcript data is not fabricated: full-source deletion still removes its captions, while partial repair needs the transcript. Export preflight warns about overlapping captions on the same visible caption track, including legacy CAP text.
- Validation: 272 tests in 43 files pass, clean typecheck, app build and MCP smoke. Real Chrome on the isolated real-Whisper fixture: deleting a source clip removed its captions, one Ctrl+Z restored both exactly, a partial word cut removed those words from the caption ranges/text without a trailing caption tail, and Export displayed the legacy-overlap warning. Unit tests cover repeated occurrences, multiple split/trim/merge operations, keep_only, speed, free-track movement/deletion and independent manual titles.
- Screenshot: C:/Users/waseem42/.codex/visualizations/2026/11/05/01a1ad05-1216-7eb0-9ff6-943327268e9e/task13-captions.png; sol13-qa.mjs beside it. The desktop installer is rebuilt to include this fix. No user project/trash touched, no commits, no new product decision.

### Task 11 correction — done (2026-11-07)
- User asked for export marks through shortcuts only after accidental ruler touches kept changing the render range. Timeline.tsx now scrubs on ruler pointer-down/move without snapping or sending ops. Removed ruler/Alt-band/bracket mark editing; brackets are passive displays. Empty-space selection and its Shift/Ctrl modes remain; the intentional clear action remains available.
- Updated Shortcuts.tsx, both skill copies, CLAUDE.md/AGENTS.md, the Task 11 specification and docs/IMPROVEMENTS.md. Root/desktop/lockfile versions are 0.1.1 for the Windows update.
- Validation: 272 tests in 43 files, clean typecheck, successful app build. Isolated real Chrome verified live scrubbing before release, small mouse jitter, clicks close to the prior playhead, dragging over a mark, Alt-band clip selection, zero unintended project writes, keyboard-only I/O setting, unchanged 10..25 Export fields, Alt+X and reload. Temporary root removed; no user project/trash changed, no commits.
- QA script/screenshot: C:/Users/waseem42/.codex/visualizations/2026/11/05/01a1ad05-1216-7eb0-9ff6-943327268e9e/timeline-scrub-qa.mjs and timeline-scrub-shortcuts-only.png. This user correction supersedes the original Task 11 mouse-range validation.
- Windows 0.1.1 build passed: artifacts/desktop/Qassa-Setup.exe (201,436,437 bytes), refreshed SHA-256 sibling. Packaged executable reports 0.1.1.0 and its UI asset hash matches the tested app build.

### Task 11 clarification — separate draggable handles (2026-11-07)
- Latest user request refines the earlier keyboard-only correction: the playhead line/head must drag and snap at cuts; export In/Out must drag from above. Timeline now has a separate 22px upper export lane and lower time ruler, so ordinary scrubbing cannot change the range.
- Playhead head and 9px line hit area support pointer-captured dragging, preserving pickup offset. Magnet targets omit the moving playhead itself to prevent self-lock and include clip edges/comments; exact final-cut seeking is supported. N toggles the magnet, Alt bypasses it. I/O grips snap to clip edges/playhead/comments, preserve pickup offset, preview live and commit one undo without moving the playhead. Default 0/end grips let users start with the mouse; unchanged clicks never create edits. I/O shortcuts and clip-band selection remain available.
- Files: Timeline/Shortcuts, snap.ts/store.ts, meaningful snap/seek tests, root/desktop/lock versions 0.1.2, both skills and CLAUDE.md/AGENTS.md. Real Chrome QA passed head/line dragging, main/overlay/audio/final-cut snaps, comment snap, Alt/N, upper-grip independence, off-center pickup, default-grip creation, one-step undo, sticky row hit targets and matching Export fields. All fixtures isolated and removed.
- QA script/screenshot: C:/Users/waseem42/.codex/visualizations/2026/11/05/01a1ad05-1216-7eb0-9ff6-943327268e9e/timeline-handles-qa.mjs and timeline-separate-handles.png. No user project/trash touched, no commits. This clarification supersedes the keyboard-only mouse-handle rule above.
- Final validation: 274 tests in 43 files pass, typecheck clean, app and Windows installer builds pass. Two tests timed out during a concurrent installer-compression run; the complete suite passed after that load subsided. Chrome also verified coincident playhead/In-grip hit targets after vertical scrolling. Packaged UI hash matches the final build; executable reports 0.1.2.0. Qassa-Setup.exe is 201,955,403 bytes; refreshed SHA-256 sibling: 04ce3399b590c82021cd2ab2685ff9a309abf433b7fb5d15920e3de2f1c9e623.


### Task 14 — done (2026-11-07)
- Shared `placement.ts` provides compatible free-track routing, group moves with a shared clamped delta and reserved destinations, and overlap spans. UI media placement, source-range additions, clip/group dragging, paste/duplicate and frame nudges use it. Preferred spans stay put when free; occupied spans use the nearest compatible family or a new track above the preferred one. Voice/music routing is preserved. Raw add_clip/move ops remain permissive; legacy overlaps are visibly striped and export preflight warns instead of blocking.
- Timeline has 150px heads with inline rename, normal 88/56/40/56 rows plus persisted compact/large sizes, native Ctrl+Shift+wheel sizing and rebindable Shift+F maximise/restore. Saved dock height survives reload; defaults fit six normal tracks at 1600x1000 while preserving viewer space. Pointer capture keeps move/trim alive outside the dock, Esc cancels, edge scrolling updates both pointer and media previews, and pointer-up resolves final coordinates. Free selections move together in one undo and snap by their outer edges; mixed V1/free selections move only free clips with a one-time explanation. Comma/period nudge one frame, Shift ten, using physical keys on Arabic layouts.
- Media/file drops snap with N/Alt and a guide; V1 retains its insertion line. Media ghosts show name, duration and thumbnail/sound indicator, a real new-layer row, or a red invalid-target reason. Stable preview row ids avoid native drag target churn. Between-row zones batch add_track/move_track/placement; uploads propagate trackIndex. OS files cannot expose reliable metadata while still being dragged: their ghost explicitly says duration is provisional until probing, and server placement is checked again with actual metadata/current state. No file is silently stacked after probing.
- Media cards are 56px high (previously about 120), show duration/kind/usage counts and sheet-based hover scrubbing. + at playhead appears on hover/focus; roles/transcription/re-analysis/sound-only/style live behind the options button. Video double-click opens SourceRange; rebindable Shift+A places the selected media safely. Grid/list switching was optional and was omitted.
- Files: shared placement/import/index and tests; app Timeline, MediaPanel, SourceRange, Shortcuts, App, timeline-view/keys/clipboard/import/source-range and CSS; server uploads/export-preflight and tests; root/desktop/lock version 0.1.3; both skill and agent-instruction copies updated. Existing project data, comments, captions, In/Out behavior and MCP permissive edits retain their contracts.
- Validation: 281 tests in 44 files pass, typecheck clean and production UI build passed. Real isolated Chrome with two videos, image and music verified six visible default tracks, taller height after reload, maximise/restore, persisted row sizes/native wheel, inline rename, pointer capture out/back, Esc/no writes, three-clip move/one undo/frame nudge, occupied-drop ghost/new layer, snap/Alt, invalid target, between-row insertion, safe clipboard, 56px cards, actual thumbnail generation/hover scrub, source-range dialog, real OS file upload, overlap stripe/preflight, horizontal and vertical edge scrolling in both directions and media edge scrolling. The preceding cursor/I/O browser suite also passes. No Whisper or paid AI call used. All fixture roots removed.
- Before: C:/Users/waseem42/.codex/visualizations/2026/11/05/01a1ad05-1216-7eb0-9ff6-943327268e9e/task14-before.png. After: task14-after.png; placement preview: task14-drop-preview.png in the same directory. Browser script: task14-qa.mjs. The design-system artifact remains unavailable through the browser tool; local tokens/components and RTL were used. No user project/trash touched, no git commits, no open product decision.

- Final package: npm run dist:win passed; executable ProductVersion is 0.1.3.0 and packaged UI hash matches the final app build. artifacts/desktop/Qassa-Setup.exe is 202,328,253 bytes; refreshed SHA-256 sibling is cb8be7fd4b64e789a88730afce6d8e07eb0ab1dcd35ff33abf6f847c6b9ce0a4. A focused real Chrome regression additionally passed magnetic V1 reorder, mixed V1/free selection, captured trim out/back, trim cancellation and releasing a free group outside the timeline. Compact header controls fit their rows. Script: task14-drag-regression.mjs beside the other QA artifacts. Task 12's fresh-profile installer/signing limitations remain unchanged; this task did not install into the user's account.

- Review artifacts copied into the current SOL-requested location: artifacts/qa/task14/{task14-before.png,task14-after.png,task14-drop-preview.png,task14-before.mjs,task14-qa.mjs,task14-drag-regression.mjs}. Copied scripts use that isolated directory for their own temporary data. The original scratch artifacts remain available too. No other agent's changes were reverted.

### Task 15 — done (2026-11-07)
- Files: MCP index/tool-schema and schema test; shared ops/placement/captions and mcp-editing.test.ts; server import/ops responses and Store notices; analysis/analyze.py/test_suggestions.py and server transcript-pauses.test.ts; scripts/check-project-mcp.mjs; package/lock dependencies; both edit-tool skill copies, CLAUDE.md/AGENTS.md and docs/IMPROVEMENTS.md.
- Removed restore_project from the MCP edit union; checkpoint/server restoration remains. The advertised draft-7 schemas hoist repeated nested definitions into local references while SDK/Zod still validate tool calls. Actual compact UTF-8 tools/list: 78,148 → 52,846 bytes; edit inputSchema: 47,511 → 22,158 bytes. Before/after payloads and metrics are in artifacts/qa/task15/{before,after}-{tools,metrics}.json. Schema-reference validation rejects malformed nested inputs and restore_project.
- render_preflight keeps ready/rev/snapshot/quality/blockers/warnings and resourceCounts by kind, listing only non-ready resources unless verbose:true. Real speech QA: 12,697 → 391 bytes, with 76 ready font files counted instead of listed. media_import returns {media,jobId,job}, null when no job exists, and wait:0..50 follows preparation without enabling transcription.
- add_clip trackId overlay/audio/text, or free:true with an explicit ID, and move free:true use freeTrackFor. They reserve against earlier ops and create tracks in the same undo; voice/music routing survives. A safe move off V1 plans against the resulting anchored-layer positions. Explicit IDs without free:true retain permissive placement. edit reports each new/enlarged free-track intersection with clip names and a free:true hint.
- cut_words clamps both boundaries outside all removed words. Long retained air across the edit shrinks to 0.12s with a caller notice; speechless islands left by earlier accepted silence cuts are removed in the same operation. Tests cover adjacent words, speed, prior cuts, endpoints, reversed ranges and linked captions. Transcript gaps >0.6s supplement energy suggestions with existing breath pads and no duplicate silence spans. Caption orphan balancing merges/repartitions within maxWords+2 and maxChars, preferring punctuation/pauses and keeping continuous occurrence links exact; genuinely separate one-word source occurrences remain independent.
- Validation: 290 tests in 47 files pass; npm run typecheck clean; npm run build -w packages/app passed; expanded isolated MCP smoke passed import job/wait/no-transcription, free add/move/undo, immediate overlap reporting, adjacent-word cuts/pause notices/check_cuts, linked captions and slim/verbose preflight. Logs: artifacts/qa/task15/{tests,typecheck,build,mcp-smoke}.log. git diff --check passed.
- Real end-to-end QA: extracted WAV from Claude's allowed night-qa fixture, combined it with ffmpeg testsrc2 in a new isolated EDIT_DATA_DIR, explicitly ran local Whisper (116 Arabic words), recovered both missed pauses near 16–18s and 53–55s, accepted silence cuts, cut words 34–36, placed two overlapping-in-time b-roll clips on separate layers plus a title, and generated 19 linked caption lines with no singleton. check_cuts has no inside-word or long-pause warning. One honest listening hint remains: the next word starts exactly at the cut because adjacent words have no available gap; padding never reintroduces the deleted word. Contact sheet, cut pairs, preflight, actual preview MP4/ffprobe duration and real Chrome/Vite editor passed with no page errors.
- Review artifacts: artifacts/qa/task15/flow.mjs, flow-log.json, flow-result.json, speech-transcript.json, edited-project.json, preflight-metrics.json, editor.png, contact-sheet.jpg, cut-pairs.jpg and task15-preview.mp4. Isolated QA servers used other ports and were stopped; all temporary data roots were removed. night-qa was read only; no user projects/trash changed, no commits, no installer rebuild. Concurrent Claude changes in SOL.md and docs/night-2026-11-07.md were preserved. Nothing required remains blocked; no product decision for Claude.

### Task 16 — done; sol stopped at its usage limit, finished by Claude (2026-11-07)
- sol built: `graphic-encoding.ts` (H.264 4:4:4 colour + FFV1 alpha in `.rgba.mkv`, `alphamerge` in compile), idle-frame reuse and up to 4 parallel capture pages in `graphics.ts`, `render-cache.ts` (usage ledger, 24 h retention, 3 GB cap, cleanup after renders and on start, `/cache` and `/cache/cleanup` routes), `RenderCache.tsx` in the export dialog, per-stage render timings, tests. Codec comparison and benchmarks are in `artifacts/qa/task16/`.
- sol hit its Codex usage limit (resets 07:10) before validating and reporting. Claude reviewed the diff. Fix: the cap removed entries the project still uses, which would make a large project re-render every export; now it only removes unused ones, with a test.
- Numbers: 64 s full-screen 9:16 graphic 3.74 GB → 0.69 GB (5.4×), 787 s → 460 s. Library template composite PSNR 58 dB / SSIM 0.9997. «تشويقة» dry run: 7.8 GB → 0.41 GB; nothing deleted.
- Validation by Claude: 303 tests in 51 files, typecheck clean, app build passes. Isolated server (port 4381, temporary EDIT_DATA_DIR): real final export with footage, a `lib/chapter` graphic and a lower third: 12 s rendered in 24 s (graphics 18.7 s, segments 1.1 s, final 3.4 s), cache 4.4 MB, transparency correct in extracted frames.
- Note: the user's running server on :4317 still runs the old code. The first start with this code cleans «تشويقة»'s stale 7.4 GB of graphics cache automatically (regenerable; the next export re-renders its two graphics in the new format).

### Task 17 — done by Claude (sol at its usage limit until 07:10)
- Files: `shared/src/edit-review.ts` (+ index export), `shared/test/edit-review.test.ts`; server `export-preflight.ts` (`review` in the preflight report, summary warning, `GET /api/projects/:name/review?aspect=`); MCP `review` tool; app `ExportDialog.tsx` `ReviewList`, `lib/export.ts` type, `index.css`; both skill copies (new gate 2.5), CLAUDE.md/AGENTS.md.
- Not done from the spec: «abrupt audio» was dropped, because the render already auto-fades music and voice gets the 12 ms cut fade. The optional badge on the export button is not done.
- Validation: 312 tests in 52 files, typecheck clean, app build passes. Isolated server and UI on a night-qa copy: correct findings in 16:9 and 9:16, click seeks and selects, RTL checked. No user project touched.

### Task 18 — done by Claude (2026-11-07)
- Version 0.1.4 (root, desktop, lockfile). `npm run dist:win` passed: `artifacts/desktop/Qassa-Setup.exe`, 202,527,075 bytes, SHA-256 134bdb846e4b0bf2b97272bf3853d92f83db424de3b60de1a16e11634ea7e6a1 (sibling .sha256 refreshed). The packaged Qassa.exe reports 0.1.4.0.
- Packaged smoke (`artifacts/qa/desktop-0.1.4/smoke.mjs`, isolated EDIT_DATA_DIR, PATH limited to Windows system folders):
  - Server health OK, NVENC detected, analysis setup not done, as expected.
  - Project created, footage imported, a `lib/chapter` graphic and a lower third added.
  - `review` clean, preflight ready with no warnings.
  - Final export: 10 s in 26.8 s (graphics 22.3 s). Frames are correct: Arabic text, a transparent graphic, the lower third bottom right. Cache endpoint OK.
- Not repeated from Task 12: single-instance, the first-run setup download, and the bundled MCP launcher against the packaged app. The app was killed with taskkill /F at the end, so `.port` stayed; that is expected for a forced kill, and a normal close removes it, as checked in Task 12.
- The user's installed copy and Documents\Qassa were not touched.
- Rebuilt at 08:02 as **0.1.5** with everything up to `822ea27` (rename, agent rule, export crash fix, capture speedup, Task 20). `Qassa-Setup.exe` 202,688,114 bytes, SHA-256 154fc3602a412d3d21ee8add94518a94c1d996e40cc0a1f39dce9c4877eda8c8; Qassa.exe reports 0.1.5. Same packaged smoke (`artifacts/qa/desktop-0.1.5/`): health, review clean, preflight ready, final 10 s export in 25.3 s (graphics 20.7 s), frames correct.
- Rebuilt at 08:41 as **0.1.6** with Task 21 and Claude's follow-ups (up to `036b28c`). `Qassa-Setup.exe` 202,876,399 bytes, SHA-256 2747fc780fc35495953941ecd6ff631cbc1050821874a33ac866a4456d70d36f; Qassa.exe reports 0.1.6. Same packaged smoke (`artifacts/qa/desktop-0.1.6/`): passed, final 10 s export in 25.2 s, frames correct.

### Task 20 — done (sol, 2026-11-07)

- Scope: only the **Left for sol** work, built on `4018b84`. Initial HEAD was `8cdd4dc` (the subsequent work-order update); its graphics implementation matches `4018b84`. No checkout/reset/stash/clean or commit. Claude's concurrent changes in `docs/night-2026-11-07.md` were preserved.
- Files: `packages/server/src/graphics.ts`, `graphic-encoding.ts`; `packages/server/test/graphic-encoding.test.ts`, new `graphic-encoding-fallback.test.ts` and `graphic-fonts.test.ts`; `docs/IMPROVEMENTS.md` and this report. No library HTML, UI, ops or MCP schema changed.
- Split diagnosis: the baseline differed on **81/1,920** PNG hashes. `document.fonts.ready` had resolved while unused faces were still unloaded. A later worker measured its first title at **275.30 px instead of 322.18 px**, caching the fallback width. Explicit face loading removed those differences except one SVG edge frame. That remaining frame had identical DOM, 274 differing colour bytes, maximum 2/255, MSE 0.00003882 and identical alpha; repeat paint changed it. Waiting for two animation frames on custom graphics removed it. The final **1,920/1,920 PNGs are byte-identical with one versus four workers**, and the serial combined hash matches renderer `sourceDigest` (`bfcf3405881a5ebed98fed5dc38a9de28677e544d12c7d7ff22079c73f40904c`). Custom output deliberately corrects the old fallback-font geometry; it is not claimed identical to the old broken render.
- Encoder sweep: same captured moving PNGs, ten preset/thread/CRF combinations. `fast` / 2 threads took 15.30 s for the sample; `fast` / 4 took 11.30 s. `superfast` / 2 took 4.49 s with better PSNR/SSIM at CRF 13. Four threads barely helped that preset, so two remain. Ordinary `veryfast` / CRF 13 lost quality and was excluded. Custom graphics now use `superfast`; a failure retries the original `fast` preset unless cancelled. Library encoding stays unchanged: its trial saved little (6.91 → 6.35 s) and changed decoded colour (PSNR 65.44 dB rather than infinity), so it was rejected for library use. Alpha remains FFV1/lossless.

| Fixture / measured step | Capture s | Wall s / screenshot | Encode s | Total s |
|---|---:|---:|---:|---:|
| 64 s custom — starting `4018b84` | 133.43 | 0.06950 | 125.36 | 259.95 |
| 64 s custom — fonts + encoder, before paint wait | 129.22 | 0.06730 | 49.02 | 179.35 |
| 64 s custom — final, paint settled | 140.86 | 0.07336 | 49.52 | **191.50** |
| 6 s chapter / blur 4 — starting `4018b84` | 7.72 | 0.04705 | 6.44 | 14.26 |
| 6 s chapter / blur 4 — final | 8.44 | 0.05143 | 6.49 | **15.05** |

- Timing controls: full-size 1080×1920 / 30 fps custom, 1,920 screenshots / four browser workers; chapter 1920×1080 / 30 fps, 720 subframes represented by 164 screenshots / two effective workers. Wall seconds per screenshot is parallel throughput including page/font preparation, not individual screenshot latency. Full-size timing runs were sequential without competing benchmarks. Serial hash runs were correctness checks and are not used as isolated performance comparisons. Environment: i5-12400F, 12 logical processors, Chrome 156.0.8078.81, ffmpeg 8.1.2, Node 24.18.0.
- Speed result: **1.36× versus the starting commit**, or 26.3% less total time. Relative to Task 16's **recorded** 459.98 s total / 327.65 s capture, final is **2.40× overall / 2.33× capture**. The extra paint wait costs 12.15 s versus the intermediate result and buys complete worker equality. Custom cache is 686,276,873 → 875,925,137 bytes (**+27.6%**). The short library fixture adds about 0.8 s of font preparation; its encoder and frames remain exact.
- Quality: full-length custom encode against its own captured PNGs improves **PSNR 42.9584 → 44.2699 dB; SSIM 0.979621 → 0.983668**. Alpha is identical. Chapter's **720/720 captured subframes** and all decoded colour/alpha frames match the baseline exactly (PSNR infinity). Additional chapter/keys/callout checks: **18/18 sampled PNGs exact**. Existing motion-blur/idle coverage is retained: 164 screenshots, 274 certified idle reuses; no sampling logic change. Normal full runs and the API export used no paint or encoding fallback; regression tests exercise failed/throttled callbacks, encoder retry, cancellation, holds, range joins and blurred alpha.
- Alternate capture experiments on both fixtures: `HeadlessExperimental.beginFrame` is unavailable in installed Chrome, even with begin-frame flags. Direct surface CDP PNG preserved pixels/alpha but offered only a small difference (heavy screenshot 185.8 → 179.8 ms; chapter 65.9 → 65.0 ms), so it was not shipped. View capture produced wrong pixels and lost alpha. Screencast can retain alpha with the proper background override, but delivered only 5 heavy / 1 chapter frames for 30 seeks. These APIs expose encoded images rather than raw RGBA; no exact raw path was retained. Existing fast PNG remains the capture path, with bounded paint-wait fallback.
- Validation: **320 tests in 56 files pass**, `npm run typecheck` clean, `npm run build -w packages/app` passes, `git diff --check` clean. Real server/API + Chrome/Vite editor on **4390 / 5190**: preflight ready, final **6.000 s / 180-frame / 1920×1080 MP4** in 25.35 s, Arabic library/custom graphics visually inspected, zero page errors. No transcription or paid AI calls; no installer rebuild.
- Evidence: `artifacts/qa/task20/README.md`, `summary.json`, `{baseline,after,settled}-long-4.json`, `{baseline,after}-library-4.json`, `determinism*-hashes.json`, `font-cause.json`, `residual.json`, `settle.json`, `encoding*.json`, `capture-methods.json`, `quality-settled.json`, `library-exact.json`, `library-encoding-trial.json`, test/typecheck/build logs, `e2e.json`, `task20-final.mp4`, `final-frames.png`, `editor.png`, and the scripts beside them. Captures/caches/fixture snapshots are archived under `captures/`, `cached/`, `fixtures/`; `artifact-map.json` maps original run paths. Both QA servers were stopped and only the isolated temporary `data/projects` tree was deleted after checked, link-free archival. User projects and trash stayed read-only; original project/graphic hashes match. User servers on 4317/5173 were not stopped.
- Open questions: **none blocking**. The measured cache-size increase and short-library startup cost above are the retained tradeoffs. Task 20 only is complete; sol stops for Claude's review.


### Task 21 — done (sol, 2026-11-07)

- Scope: Task 21 only. Full first-user walkthrough in real headless Chrome, isolated `EDIT_DATA_DIR=artifacts/qa/task21/data`, server **4391**, Vite **5191**. Generated video/audio/image/CSS fixtures only. All project creation/editing/export actions used UI controls (DataTransfer drops exercise real upload handlers); read-only store/API observations assert results. User projects and trash, Documents\Qassa, installed Qassa, and servers 4317/5173 were not accessed or changed. No transcription, paid AI calls, git commit/reset/checkout/stash/clean or installer rebuild.
- Files: app `Home.tsx`, `ExportDialog.tsx`, new `lib/project-name.ts` + `test/project-name.test.ts`; render `compile.ts` + compiler test; server `export-preflight.ts` + its test; `docs/IMPROVEMENTS.md` and this report. No edit-op, MCP schema/tool-doc, design/layout or review-policy change.

| Step | What happened | Severity | Fixed / proposed / passed |
|---|---|---|---|
| 1 Home | Names with spaces became hyphenated on creation and Home video drops. | Low | **Fixed**: display title kept separately from safe unique folder; Arabic/punctuation/collision regression. New UI creation and Home drop both preserve spaces. Screenshots `38`, `57`. |
| 1 Home | Created, renamed and reopened video, podcast and empty starts; correct distinct track sets. | — | **Passed**. `01-home-empty.png`, `02-start-*.png`, `03-renamed-*.png`. |
| 2 Import | Dropped video/audio/image together; all placed, progress shown, analysis/waves/thumbs completed and playback advanced. Audio-only podcast import also plays on V1. | — | **Passed**. `04`–`06`, `39`–`40`, `55`–`56`; snapshot analysis steps exclude transcribe. |
| 3 UI edit | Trim, split, ripple delete, cross-track move, title, library chapter graphic and its text, music levels/fades; undo/redo restored checked edits. | — | **Passed**. `07`–`15`, `41`–`43`. No injected edit ops/store mutations. |
| 4 Notes/marks | Saved comments without execution, set physical-key I/O and exported the marked range. | — | **Passed**. `16`–`17`, `44`; actual files are exactly 5.000 s for 1..6 and 4.000 s for 1..5. |
| 4/6 Range metadata | Correct 5 s MP4 had render result duration 12 s. | Low | **Fixed**: plan.duration now equals final output duration; full cached segment durations unchanged. Compiler regression; post-fix real 4 s metadata and ffprobe agree (`54`). |
| 5 Styles/brand | Applied style with provenance/undo; CSS identity upload opened review, applied and undid/redid without AI. | — | **Passed**. `18`–`23`, `47`. |
| 5 Discovery | Initial style gallery shows many raw English prompts and technical categories before immediately applicable looks. | Medium UX | **Proposed**: beginner-facing default/curated entry set; no layout or default changed (`18`). |
| 6 Export review | Changing export to 9:16 retained landscape review, hiding unsafe-area findings. | Medium | **Fixed**: validated preflight aspect + dialog recheck on aspect changes; submission review uses output aspect. API regression retains project/revision/fingerprint; UI 16:9→9:16→16:9 verified (`28` before, `32` after). |
| 6 Export/errors | Preflight/review/final export/open work. Missing generated source blocks export, restoration + recheck recovers; empty project blocked. | — | **Passed**. `24`–`27`, `33`–`37`, `58`–`59`. Whole 12 s landscape and 6.5 s portrait exports also opened and probed. |
| 6 Invalid file | Corrupt MP4 leaves valid edit intact but exposes a large raw ffprobe error/internal UUID path. | Medium UX | **Proposed**: short Arabic diagnosis/recovery copy plus expandable technical details; error contract unchanged (`31`). |
| 7 Keyboard | Arabic key values plus physical codes: split, play, comments, titles, I/O, undo/redo; shortcut editor records B for split, works, resets. | — | **Passed**. `29`–`30`; OS keyboard layout itself was not switched. |
| 8 Portrait | 9:16 import, cuts, title/graphic, image timing, music/fades, style, notes/marks and exports work. Unsafe finding seeks/selects its title. | — | **Passed**. `38`–`54`; 720×1280 outputs have 195 and 120 frames at 30 fps. RTL/empty panels also checked (`52`–`53`, `60`–`64`). |
| 8 Review discovery | Unsafe-area-only findings are collapsed as “للنظر”; marked-export review includes the whole timeline (including this fixture's music-only tail). | Low UX | **Proposed**: explicitly label review scope and decide whether unsafe findings should expand automatically. Existing scope/severity preserved (`45`, `24`). |

- Validation: **322 tests / 57 files pass** with ordinary `npm test`, `npm run typecheck` clean, `npm run build -w packages/app` passes (existing Vite chunk-size warning), `git diff --check` clean. Initial validation runner's EDIT_PROJECTS_DIR override conflicted with the data-dir test and was removed; a subsequent concurrent QA run hit existing Chrome font-test timeouts. With QA browser/servers stopped, normal full suite passed in 12.03 s; no tests skipped, timeouts increased or unrelated code changed.
- Evidence: `artifacts/qa/task21/README.md` (full audit and proposals), `screenshots.json` (**70 screenshots**, chiefly 1600×1000 plus narrower initial/trim views and deliberate 1366×768), `audit-results.json`, `guard-check.json` (**106 UI mutations, 0 agent/0 transcription requests**), `requests.jsonl`, `snapshots/`, `exports/` (four MP4s plus visually inspected decoded frames), browser stage scripts and test/typecheck/build logs. Zero page errors recorded. Files: landscape **1920×1080 / 150 frames / 5.000 s** and **360 / 12.000 s**; portrait **720×1280 / 120 / 4.000 s** and **195 / 6.500 s**, all 30 fps.
- Cleanup: automatic review rejected direct recursive filesystem removal (“blocked by policy”). A safer scoped fallback checked the isolated server dataDir and exact five QA names, then removed each via validated project-delete and UUID trash-purge routes. Both isolated lists ended empty (`cleanup.json`); all QA servers/browser stopped. Evidence/fixtures/isolated brand/style data remain under `artifacts/qa/task21/`. No user project/trash involved.
- Limits/decisions for Claude: synthetic-media web-editor audit; no subjective speech-cut listening assessment, transcription/paid-model quality, packaged installation or runtime download tested. Recommended product order: friendlier invalid-file errors, clearer review disclosure/scope, then beginner style-library entry. These remain **proposals only**, none blocking this task. Task 21 complete; sol stops for Claude's review.


### Task 22 — done (sol, 2026-11-07)

- Scope: Task 22 only. No Task 23 work, commit, installer rebuild, transcription or paid AI calls. Left the user's pre-existing changes in styles/favorites.json and styles/recent.json alone; no user projects/trash or servers on 4317/5173 were changed.
- Files: app App.tsx; components Inspector.tsx, Timeline.tsx, Viewer.tsx; index.css; lib/store.ts, keys.ts; new lib/title.ts and lib/library-placement.ts; new test/title.test.ts and test/library-placement.test.ts; docs/IMPROVEMENTS.md and this report. No op schema, renderer, MCP tool docs or project rules changed.
- Titles: toolbar, inspector and shortcut call the same action/helper. Consistent style, an available unlocked text layer, duration min(4, remaining content) with a 1 s minimum (4 s without remaining content). The new clip is selected, properties open on النص, and its text field receives focus with all words selected. The paused selected entrance is visible immediately; deselection and playback restore the real animation (observed selected playback opacity 0.083 at 0.029 s, paused opacity 1). A 3 s video plus a new title still ends at 3 s. Tests also cover no content, endpoints, less than 1 s remaining, overlapping titles and locked text layers.
- Timeline: insert zones are hidden/pointer-transparent during ordinary hover, enabled for media drops only during the drag, and indicated during clip/track drags. «التصاق» distinguishes snapping from «الأساسي». Audio routing is a small fully readable «ينخفض تحت الكلام» / «كلام» chip. Toolbar/transport tooltips read current keys.ts bindings, including cleared/rebound shortcuts through the shared formatter.
- Empty viewer: «أضف ملفاتك» plus import before any media; library placement guidance and «ضع الكل على التايملاين» afterwards; no repeated start buttons. The action batches the existing mediaPlacementOps path over a working project copy, preserving library order for videos/images on V1 and leaving audio unplaced. Store regression verifies a single undo/redo restores the entire batch, including the image's existing 5 s fallback.
- Validation: **338 tests / 66 files pass**, npm run typecheck clean, npm run build -w packages/app passes (existing chunk-size warning), git diff --check clean. Initial sandboxed Vitest/Vite runs hit Windows realpath EPERM; approved escalated reruns passed. The first broad test run also hit an existing upload-test timeout during concurrent build/typecheck; an ordinary full npm test rerun with those jobs finished passed without changing that test or its timeout.
- Real editor: generated 3 s video, still and sine-wave fixtures only, isolated EDIT_DATA_DIR=artifacts/qa/task22/data, server **4392**, Vite **5192**, real Chrome at 1600×1000 and 1366×768. Verified all three title entries and actual typing; saved text-tab recovery; paused/deselected/playing appearance; live shortcut rebinds; no hover bar or edge interception; real between-track media placement; routing-chip switching; library video/image order and single UI undo/redo. **Zero page errors, no agent/transcription requests**. Fixtures/project creation used the isolated API; imports and feature edits used the UI, with dev-store selection/panel setup for focused cases and the real key-settings store for rebind verification.
- Evidence: artifacts/qa/task22/editor.mjs, editor-results.json, editor-run.log, tests.log, typecheck.log, build.log; screenshots 01-empty.png through 09-batch-placed.png (03/04/05 show the three title entries; 06 idle hover; 07 insert drag; 08 RTL). Visually inspected title, small viewport and chip screenshots. The remote identity link in brand/README.md was unavailable; existing local brand tokens/components were followed.
- Cleanup: QA analysis jobs were cancelled/waited as needed; temporary Windows file-lock errors during cleanup were retried through the validated project-trash/purge API. Final project and trash lists are both empty; Chrome and both QA servers stopped. Fixtures/logs/screenshots remain under artifacts/qa/task22/. Nothing required remains blocked; no product decision for Claude. Task 22 complete; sol stops for review.


### Task 23 — done (sol)

- Scope: Task 23 only, based on 033bfcb (Task 22 already committed by Claude). Files changed: packages/app/src/components/ExportDialog.tsx, packages/app/src/index.css, docs/IMPROVEMENTS.md and this report. No Task 24 work, new ops, shared/server/render/MCP changes, commit or installer rebuild. The user's pre-existing styles/favorites.json and styles/recent.json edits were left alone.
- Default dialog: presets → file name → whole/marked part → closed «إعدادات متقدمة» → output summary, readiness and start side by side. Six video tiles occupy two complete three-column rows; audio is a compact full-width row (two columns for video tiles on phones). Format/aspect/resolution/fps/quality/codec and conditional caption controls are unchanged inside Advanced. Version/cache diagnostics moved into a separate closed disclosure; blocker/warning markup and ReviewList remain outside it, with the original review function unchanged.
- Per-viewer memory: qassa.export.advanced records whether the last successfully queued export was custom. A custom export opens Advanced next time, even in another project; exporting a preset restores the simple default. Existing saved custom exports migrate using their preset when there is no viewer flag. Storage reads/writes are guarded; failed browser storage still permits normal export. Existing per-project saved export settings and request-body construction are retained.
- Validation: **338 tests / 66 files pass**, npm run typecheck clean, npm run build -w packages/app passes (existing chunk-size warning), git diff --check clean. Approved escalated execution was used for Vitest/Vite because of the previously observed sandbox realpath restrictions. No new unit tests for this reversible layout change; the actual browser/export checks below exercise its state and persistence.
- Real Chrome: isolated server **4393**, Vite **5193**, EDIT_DATA_DIR=artifacts/qa/task23/data; generated 3 s test pattern/sine footage and an Arabic title only. At **1366×768**, initial dialog scrollTop is 0 and the primary button occupies y=609.64..652.64, visible without scrolling even with the saved 0.5..2.5 range fields. Advanced options stay reachable, including all four caption modes. Checked custom-memory reopen/cross-project behavior, preset reset, blocked empty edit, recheck, the existing unsafe-area review click seeking/selecting its text, a WAV export and unavailable localStorage. At **390×844**, dialog clientWidth and scrollWidth both equal 356 px; no horizontal overflow. No page errors, transcription or paid AI.
- Export comparison: baseline recorded before source changes, then actual UI exports before/after with MOV, 9:16, 720p, 24 fps, high quality, H.264, range [0.5,2.5]. Export settings match aside from file name (revision checks naturally reflect the restarted isolated server). **ffprobe metadata matches exactly**: H.264 yuv420p 720×1280, 24/1 fps, 48 video frames, 2.000 s; AAC 48 kHz stereo, 2.000 s. **Decoded video SHA-256 matches exactly**. Additional actual outputs: WAV pcm_s16le 48 kHz stereo / 2.000 s, and preset MP4 H.264 1920×1080 / 30 fps / 2.000 s.
- Evidence: artifacts/qa/task23/qa.mjs, before.json, after.json, baseline-known-issue.json, tests.log, typecheck.log, build.log, cleanup.mjs/cleanup.json, task23{-viewer}-snapshot.json; before/after-default-1366.png, before/after-advanced-1366.png, after-advanced-options.png, after-remembered-advanced.png, after-empty-blocked.png, after-mobile.png; before/after-advanced.mov, after-audio.wav, after-preset.mp4. Default, advanced-options and mobile screenshots were visually inspected.
- Pre-existing issue for Claude: before changing any source, a marked MOV export of the single imported video without overlays failed in ffmpeg final pass: “Output with label '0:v' does not exist in any defined filter graph, or was already used elsewhere.” The failed baseline job/settings are archived in baseline-known-issue.json. Adding the fixture's Arabic title permits the comparison export. This was left untouched because Task 23 explicitly limits changes to dialog layout; it is not introduced by this change.
- Cleanup: saved QA snapshots and outputs, removed only task23 and task23-viewer through validated project-trash/UUID-purge routes. Final isolated project and trash lists are empty; Chrome and QA servers stopped. No user projects/trash, Documents/Qassa, installed app or servers 4317/5173 were touched. Nothing required remains blocked; no product decision needed for Task 23. Sol stops for Claude's review.


### Task 24 — done (sol, 2026-11-08)

- Scope: Task 24 only, based on 4b6c780 (Claude's Task 23 review/render fix preserved). No Task 25 work, commit, installer rebuild, transcription or paid AI. The existing styles/favorites.json and styles/recent.json changes were left alone. No user projects/trash or servers 4317/5173 were changed.
- Files: new app components/StartGuide.tsx, lib/start-guide.ts, test/start-guide.test.ts; app App.tsx, lib/store.ts, index.css; components Assistant.tsx, AgentTasks.tsx, Ideas.tsx, Transcribe.tsx, RuntimeSettings.tsx, MediaPanel.tsx, Timeline.tsx, Inspector.tsx, GraphicControls.tsx, EditingStyles.tsx, ui.tsx, ExportDialog.tsx; shared schema.ts (new-track label only) and tracks.test.ts; docs/IMPROVEMENTS.md and this report. No new op, op schema, renderer, MCP name/tool-doc or rule changes; skill copies/AGENTS/CLAUDE therefore need no update.
- Labels: «جزء التصدير» in the ruler and the export's range hint (no «من العلامات I/O»); «اسحب المقبضين لتصدير جزء فقط»; «ملاءمة الكل»; «لقطات فوقية» in new-project defaults and UI role/recipe/idea wording; «تكبير وتركيز», «◎ نقطة التركيز», «◆ حركة» with the requested tooltip. Saved V2 names are not migrated. Nine position boxes replace bare arrows, with Arabic tooltips/accessible labels and a separate full-frame reset. Position/anchor grids put the right-hand coordinates on the physical right; existing placement/anchor ops remain in use.
- Assistant: request box first. For projects without ideas, one compact ideas line and one compact transcription line expand only on «اعرض»; both can collapse. The duplicate request-card transcription offer is suppressed in that compact mode. The compact offer can show an imported source before it is placed, but every transcription action still requires its explicit button. Existing ideas retain their full cards, controls and transcription behavior.
- Guide: four compact steps above the workspace; current media/clips, successful substantive edit ops and completed render jobs drive the checks. Plain media placement, marks and setup are excluded from the edit milestone. A new title is also detectable from project state. Dismissal and up to 100 project edit milestones use guarded viewer localStorage, keyed by creation time so renaming preserves progress. «وريني» opens the relevant panel/tab or hidden timeline and flashes/focuses import, the library +, title, or export without activating the action. Settings «أعد عرض دليل البداية» reopens it. Old render jobs predating project.createdAt are ignored when a deleted project name is reused.
- Tests: **342 tests / 67 files pass**, npm run typecheck clean, npm run build -w packages/app passes (existing chunk-size warning), git diff --check clean. Four guide regressions cover independent steps, placement versus edits, storage/dismiss/reopen, project rename/incarnation keys and old/unfinished jobs; track regression verifies the new default and unchanged legacy names. Vitest/Vite used approved escalated execution for the previously observed Windows sandbox realpath restriction.
- Real editor QA: **4394 / 5194**, isolated EDIT_DATA_DIR=artifacts/qa/task24/data, generated 3 s video/sine only, Chrome **1366×768**. Actual UI import → library + → title → export ticks all four steps, with no edit tick on placement and no export tick until completion. All four «وريني» highlights were visible. Edit milestone survives reload; dismissal survives reload/project switching; Settings replay and unavailable storage work. Checked request-first geometry, compact offer expand/collapse, all nine position buttons and physical RTL order, top-right placement (positive dx / negative dy), top-right anchor ax=1, full-frame reset, movement tooltip, updated range/fit/focus labels, unchanged old V2 name and a saved idea remaining expanded. **Zero page errors and no agent/transcription POSTs**. Selection setup and legacy idea/name/marks fixtures used the isolated dev store/API; the first-run editing/export path used UI controls.
- Export evidence: actual walkthrough.mp4 is **3.000 s / 1920×1080 / 30 fps / 90 frames**, H.264 with AAC audio, confirmed by ffprobe. Artifacts: artifacts/qa/task24/README.md, qa.mjs, results.json, qa-run.log, tests/typecheck/build logs, ffprobe.json, task24{-old}-snapshot.json, and screenshots 01–11 (03b compact offers, 07a position boxes, 07 anchor grid, 09 all steps complete, 10 replay, 10b range wording, 11 existing ideas). Key guide, grid, compact-offer and legacy-card screenshots were visually inspected. The design follows existing local brand tokens/components; the brand README's remote identity link was unavailable in the earlier checks.
- Cleanup: archived generated snapshots/output, cancelled/waited ordinary QA analysis as needed, removed only task24 and task24-old through validated project-trash and UUID-purge routes. Final isolated project/trash lists are empty; Chrome and both QA servers stopped. Evidence remains under artifacts/qa/task24/. No required item is blocked and no product decision is needed. Task 24 complete; sol stops for Claude's review.


### Task 25 — done (sol, 2026-11-08)

- Scope: Task 25 only, based on 4a2c541; Task 24 and Claude's work preserved. Files: app App.tsx; components Header.tsx, StartGuide.tsx, Timeline.tsx, Viewer.tsx; index.css and lib/store.ts; new lib/workspace-layout.ts and test/workspace-layout.test.ts; docs/IMPROVEMENTS.md and this report. No server/render/shared schema or ops, MCP/tool-doc/rule changes, commit or installer rebuild. Existing styles/favorites.json and styles/recent.json user changes were left alone.
- Library/panels: below the existing 1600 px docking threshold, a named «مكتبة المشروع» button remains visible at the viewer's library edge. It opens a 340 px overlay, preserving the tools panel below; heading close, outside press and Escape work, with focus returned when possible. Native dialogs/menus keep their own Escape handling. Opening a tool closes the transient library overlay. Panel preferences are no longer forcibly rewritten on resize; widening docks a requested library again. Rail/window-menu toggles and wide-preview restore use actual library visibility. Overlay state resets when opening/closing a project.
- Split: visible 24 px labelled drag grip, pointer capture/cancel, keyboard arrows, double-click 40% reset, and maximise/restore. The split uses the actual viewer+timeline container (excluding a full guide), and saves qassa.workspace-split per viewer. A ratio restores across sizes; minimum timeline is 160 px and at least 220 px remains for the workspace. Valid older timeline-height values within 45% of available space migrate. Larger old values, often auto-saved while the old 48vh CSS cap hid their true size, fall back to 40%; the old key is retained. This deliberate migration avoids restoring the original cramped viewer.
- Toolbars/guide: header, timeline and transport wrap; timeline control labels are 12 px and its select is at least 32 px high, with existing 34 px primary controls. No zoom-down scaling. At **height ≤820 px**, the guide is a header button with live N/4 progress and a popover; outside press/Escape fold it, and its existing close/dismiss/Settings/«وريني» paths remain available. Taller windows retain the full guide. No blanket font/button reductions were introduced.
- Real Chrome QA: isolated **4395 / 5195**, EDIT_DATA_DIR=artifacts/qa/task25/data, generated 3 s video/sine only. Mouse import → library + → title → export passed independently at **1280×720**, **1366×768**, **1536×864**. Last case used **devicePixelRatio 1.25**, producing physical 1920×1080 screenshots; OS display scaling was not changed. At all sizes: library overlay preserves tools, heading/backdrop/Escape close, all four tools pages reachable, wide-preview restore, resize to 1700×950 docks both panels and resize back exposes the library button, split drag/reload persistence and maximise/double-click reset work. Window-menu, styles, Settings, jobs and checkpoints were separately opened/closed by mouse at each size. Compact-guide Escape and «وريني» import highlighting work.

| CSS viewport | Default viewer frame, before → after | Timeline default → dragged | Toolbar hit tests |
|---|---:|---:|---|
| 1280×720 | 182 → **277 px** | 269 → 369 px | 28 visible header/timeline/transport controls; none obstructed |
| 1366×768 | 207 → **306 px** | 288 → 388 px | 28 controls; none obstructed |
| 1536×864 @1.25 | 257 → **327 px** | 303 → 403 px | 27 controls; none obstructed |

- Expanded screenshots show all four starter tracks. Default and marked-range toolbar geometry/hit tests both pass without horizontal body overflow. All three actual preview exports are **1280×720 / 30 fps / 75 video frames / 2.500 s**, H.264 with AAC audio, confirmed by ffprobe. **Zero page errors, no agent/transcription POSTs**. Project creation and range-mark fixture setup used the isolated API; import, title, panel navigation, split and export used real UI controls.
- Validation: **345 tests / 68 files pass** with `npm test -- --maxWorkers=2 --minWorkers=2`; three new regressions cover workspace bounds, ratio restoration/legacy migration and unavailable storage. Two ordinary parallel runs hit existing brand-font (15 s) and upload (5 s) timeouts; their logs are preserved. No tests skipped, timeouts increased, test config or unrelated tests modified. `npm run typecheck` clean, `npm run build -w packages/app` passes (existing chunk-size warning), `git diff --check` clean. Escalated Vitest/Vite execution used the already established Windows realpath workaround.
- Evidence: artifacts/qa/task25/README.md, env.mjs, before.mjs, after.mjs, access.mjs, before.json, results.json, access.json, focused-tests/tests/typecheck/build logs and the two parallel-run logs; before-{1280x720,1366x768,1536x864}.png; each size's -editor/-library/-timeline-expanded/-export screenshots and MP4; short-size -guide screenshots; generated project snapshots. Default, overlay, expanded, guide and 125% images were visually inspected. Existing local brand tokens/components were followed; the remote identity link was unavailable in earlier checks.
- Cleanup: all generated baseline, three size-specific and access QA projects were removed through validated project-trash/UUID-purge routes; final isolated project and trash lists are empty (only the empty .trash directory remains). Browser contexts and QA servers stopped; only evidence/fixtures/logs remain in artifacts/qa/task25/. User projects/trash, Documents/Qassa, installed app and servers 4317/5173 were not changed. Nothing required remains blocked; the parallel-suite timing limitation above is disclosed for review. No product decision needed. Task 25 complete; sol stops for Claude's review.


### Claude, night of 2026-11-08 — after Task 25 (new baseline for sol)

Task 25 reviewed and committed (38c3b18). Claude then added competitor features (see docs/IMPROVEMENTS.md «Competitor features, first pass»): command search Ctrl+K (`CommandPalette.tsx`, shortcut behaviour now in `lib/actions.ts` `runAction`), Q/W trim to playhead, silence tuning (min length, breathing room, speed up ×4 instead of cut), preview speed ×1/×1.5/×2 (Shift+R), word-highlight captions (`textStyle.highlight`, `shared/src/caption-highlight.ts`, export expands to one still per word), filler words («كلمات الحشو», `shared/src/fillers.ts`), click-the-clock go-to-time. 364 tests pass. Open product question for the user: face-centred auto-reframe for 9:16 needs a downloaded face model (OpenCV 5 here has none).

### Task 26 — measurement delivered (2026-11-16; no fixes)

- Report: `docs/research/practical-2026-11.md` has all five measurement areas, 15 explicitly modelled priorities and a separate bug list; evidence/runnable JSON scripts are in `artifacts/qa/task26/`. Light/heavy/copy of تشويقة; isolated 4496/5296 only. Heavy cold/warm/5 s marked exports: 119.78/102.08/33.63 s; 90 editor attempts, 13 historical AI records, real MCP brief 6 calls / 3 undo clicks, two viewport inventories; one 296 ms startup freeze profiled (GradeRenderer/WebGL + Timeline layout). Confirmed animated-text `ENAMETOOLONG`, silent drop on playhead, zoomed paused seek off-screen, filename-reset behavior; none fixed. Native Explorer screenshots/accessibility confirmed both marked files visibly selected; those observation times include controller delay and are upper bounds. 373 tests/75 files, typecheck and app build pass. All temporary data removed and owned servers stopped; no paid agent/Whisper, user-project writes or commit; prior SOL/style changes preserved. Limit for Claude: ±10% timing stability was not achieved; task is not an unconditional acceptance pass. Decide naming persistence and review measured causes before Tasks 27–31; sol stops here.

**Review by Claude (2026-11-16):** accepted as a measurement. Spot-checked the cited code (`store.ts:371` optimistic ops, `Timeline.tsx:465`/`:851` playhead hit test, `compile.ts:654` late range): correct. The ±10% rule is relaxed to medians of three runs in the same cache state. File names: keep the preset suffix and remember a typed name per project (now in Task 28). Tasks 27–32 are rewritten from these findings; the open gap is speed on real-size footage (Task 30).

### Task 27 — partly (night run)

- Long graphs now use relative filter files; ranged text/graphic preparation is pruned; whole-edit loudness gain has audio/source-sensitive caching. Animated-heavy cold/warm/marked renders all succeed (600 s/18,000 frames; 5 s/150 frames). Final warm marked medians: static 1.68 s, animated 1.62 s (three each), versus 33.63 s / failure. Files: render compiler/runner/tests, server render preparation, `docs/research/night-2026-11.md`; evidence `artifacts/qa/task27/`. 376 tests, typecheck and app build pass. Missing: V1 outside-range segment planning remains; five decoded H.264 frame hashes differ across independent encodes; cold-full no-regression/three-cold median not established (one heavy cold run took 287.68 s, dominated by text preparation, warm 70.75–72.33 s). These are not acceptance passes. Data/servers cleaned; user projects/styles untouched. Continue to Task 28 under Night rules.

### Task 28 — done (night run)

- Remembered one-click export, split settings/marked menu, header progress, persistent completion/failure actions, warning counts, preserved preset/custom names, searchable rebindable Ctrl+E / Ctrl+Shift+E. Existing snapshot/preflight/output guards remain. Chrome: repeat 1+1 clicks, dialog never opened, metadata identical (60 s, 1800 frames, H.264/AAC 720p30); actual marked export, warning-only export, blocker, delayed stale-revision guard and name numbering pass. Failure feedback tested with a labelled browser fixture. 379 tests/76 files, typecheck/build pass. Evidence `artifacts/qa/task28/`; details `docs/research/night-2026-11.md`. Remote brand link unavailable; local tokens/components followed. Temporary data/owned servers removed; no user-project/style changes. Continue to Task 29.
### Task 29 — partly (night run; behavior fixes pass)

- Geometry-based drops through the playhead, click-through clip selection versus line dragging, paused seek reveal, nearby refusal messages, and menu/rebindable ±1 dB gain with one undo per 300 ms burst implemented. 90/90 Chrome trials, both playhead-drop sets 3/3, line click/drag, five-key single-undo burst, locked/ruler refusal, between-row insertion and 8:30 visibility pass. 382 tests/78 files, typecheck/build pass. Evidence `artifacts/qa/task29/`; details `docs/research/night-2026-11.md`. Strict no-slower line is not met: light trim release median 9.8→11.1 ms and seek 7.2→10.5 ms; other medians improved or within 1 ms. No user data/renderer/MCP/schema changes; QA cleaned. Continue to Task 30.
### Task 30 — partly (night run; measured path passes, startup limitations remain)

- Five generated real-size sources imported normally (4K30,1080p60,20 min screen,HEVC,1080p24), 112.93 s to usable. Ten-minute/166-clip edit tested in real headless/headed Chrome before/after; preview paths are proxies and analysis manifests unchanged on reopen. No >100 ms long tasks during measured play/scrub/drag. GL initialization deferred after first paint; ResizeObserver replaces initial forced layout; initial HTML/GL waits now have visible Arabic status. 1080p export before cold/warm 116.53/78.88 s (11.65/7.89 s per video minute), final composition dominates. Native startup still 183–216 ms; cold Vite modules waited 2.8–3.5 s. Single samples, one overlapped-check export and no full 90-operation real-size repeat mean no broad speed certification. 382 tests/78 files, typecheck/build pass. Details/table/evidence in docs/research/night-2026-11.md and artifacts/qa/task30/. Temporary data/owned servers cleaned; generated fixture assets retained. Continue to Task 31.

### Task 31 — partly (night run; paid comparison blocked by login)

- Session task boundaries tag MCP requests; finished cards group/navigate changes and restore all batches with one click. Any outside write during/after the task refuses full restore with a reason; tests cover both, guarded restore, async Fastify context and metrics. Full-state MCP defaults to 40 clips with explicit truncation/paging/exact ids/full opt-in; heavy actual payload 77,554→6,277 bytes (91.9%). Logs include tool counts/result bytes/largest results; deep time estimate shown; both skill copies updated. Real Chrome + actual MCP via a labelled fake CLI verified one-click undo, change navigation, interleaved-user refusal and persisted telemetry. 387 tests/81 files, typecheck/build pass. Two real Claude invocations attempted: first harness canceled before a cost result (unknown), corrected baseline returned Not logged in, recorded $0.000 and no tools/tokens. No after paid run against the known failure, so paid before/after efficiency remains unverified. Boundaries expire after restart/20 tasks (clear reason; change lists persist). Details/evidence docs/research/night-2026-11.md, artifacts/qa/task31/. Data/servers cleaned. Continue to Task 32.

### Task 32 — done (night run)

- Added remembered InspectorGroup and effective-value markers; grouped less frequent picture/audio/time/text/graphic/SFX controls while keeping primary fields open. No feature, op, shortcut or command-search action removed. Same clutter inventory: video picture 33→15, audio 23→15, time 16→15, text 16→12, graphic content 20→14, place 37→13, SFX 21→14. All 40 default inspector states ≤15; an additional corrected top-of-tab 22-state check covers free video/music/linked captions at both sizes. Changed closed groups, reload/per-viewer memory, non-editing folds, retained array/key controls and 90/90 daily editor trials pass. 388 tests/82 files, typecheck/build pass. Files: app Inspector/GraphicControls/ui, InspectorGroup, inspector helper/test, token CSS; details/screenshots/scripts in docs/research/night-2026-11.md and artifacts/qa/task32/. Data/owned servers removed; protected samples/styles/AI logs unchanged. No push.

### Night summary — 2026-11-16

One sequential local commit per task, on master; no push. Tasks 27–32 were all attempted, with explicit partial acceptance below. No user project writes or original 4317/5173 server operations; only isolated 4496/5296 QA, now stopped. Final checks: 388 tests/82 files, typecheck and app build pass. The two pre-existing style-history changes remain uncommitted and byte-identical to the start.

| Task | Status | Local commit / remaining review |
|---|---|---|
|27|partly|1d6492e — animated export failure fixed, warm marked medians <2 s; strict full/range frame parity, full V1 range pruning and cold-full median acceptance remain.|
|28|done|666cf1b — one-click repeat export, guarded snapshots, persistent feedback, marked menu and saved names verified.|
|29|partly|5c774c4 — all four behaviors and 90 trials pass; two light medians rose 1.3/3.3 ms, so literal no-slower acceptance is open.|
|30|partly|a3ac6ad — real-size/headed measurements, proxy reuse and load feedback; native startup still >100 ms, single-sample/cold Vite limits and no full real-size operation inventory.|
|31|partly|19bced1 — safe full-task undo/change list/metrics and 92% smaller heavy default state; successful paid brief comparison blocked by CLI login. Corrected baseline cost $0.000; first immediately canceled harness invocation has no captured cost.|
|32|done|this commit — remembered groups, changed markers and ≤15 measured default controls; daily trial paths preserved.|

**Claude: look first** at Task 27's export-parity/cold-time gaps before accepting render correctness/performance, then Task 31's task-boundary refusal semantics and the required authenticated before/after brief. Task 30's profiles separate native startup/Vite waits from smooth measured editing; do not call all real footage fast from these short samples. Task 29's small median increases are disclosed, not hidden. Detailed tables, limitations and runnable QA evidence: docs/research/night-2026-11.md and artifacts/qa/task27–task32/. No further task was started.

### Review by Claude — night run Tasks 27–32 (2026-11-16)

All six commits read; 388 tests, typecheck pass on `270a811`. Not yet walked by hand in the browser by Claude or the user.

- **Task 27 — accepted.** Claude reran the heavy fixture on `270a811` (`artifacts/qa/claude-1116/`): full cold 282.8 s, full warm 42.9 s (Task 26: 119.8 / 102.1). The cold time is real and repeats, but it is not from this task: ≈193 s of it is the «text» stage before graphics, and `packages/server/src/textimg.ts` has not changed since `b7a4f3b`. It renders 121 texts one by one, about 1.6 s each. Task 26's 119.8 s cold run most likely had those images cached already. This becomes Task 33. The frame-hash line was Claude's mistake (two lossy encodes never match bit for bit); duration and frame counts are the right check. V1 segments outside a marked range on a cold cache stay open, low priority.
- **Task 28 — accepted** on the report and the diff.
- **Task 29 — accepted.** The 1–3 ms increases are not a failure; the «no operation got slower» line meant what a hand can feel.
- **Task 30 — accepted as a measurement.** Real-size footage plays on proxies with no long task after loading. The user's «slow and hangs» is still not reproduced; Claude is asking the user where it happens.
- **Task 31 — accepted, one thing to watch.** `project_state` now returns 40 clips by default. This also changes what Claude sees in ordinary MCP sessions, so the truncation notice must stay loud. The paid before/after comparison is still open (the test run was not logged in).
- **Task 32 — accepted** on the report and the diff.

### Task 33 — done (sol, 2026-11-16)

- `server/src/textimg.ts`: one document/font setup per worker, swaps only the text layer; at most four browser processes, capped by available CPUs and batch size. Identical missing cache entries are coalesced; progress counts all clips, including cache hits. Cancellation drains/closes workers. Cache version 3, hash inputs and `cache/text/<hash>.png` layout are unchanged. `server/src/index.ts` records `timings.text` and sends «نصوص n/total» over 0–15% (graphics 15–30%). `app/src/components/ExportDialog.tsx` now displays that message; the old job card discarded it.
- Three sequential **fresh-cache full heavy exports** (121 texts, 600 s, 1280×720/30): `timings.text` **3.036 / 2.544 / 3.324 s; median 3.036 s**, below 30 s. Total exports 93.57 / 119.03 / 104.69 s; final composition remains dominant. All are 600 s / 18,000 H.264 frames with AAC. Real Chrome shows «نصوص 27/121» at 3%; 371 text-stage WebSocket updates recorded. The initial QA attempt exposed background Home-cover cache warming and the missing UI message; its results are retained separately. The accepted run opens an empty editor before creating the heavy fixtures, verifies empty text caches before each export, and has no concurrent checks.
- **120/120 decoded RGBA comparisons exact (zero differing pixels)** against the unmodified old function: five presets, Arabic/Latin, all seven fonts, highlighted captions including inactive/out-of-range words, landscape and portrait. All 121 new text PNGs also have identical hashes across the three cold runs. Fast PNG encoding increases sampled PNG bytes by 62–79%; decoded pixels and existing cache keys remain identical. The controlled old-function-only batches here took 10.076 / 9.998 / 9.757 s (median 9.998 s); Claude's earlier ≈193 s was **not reproduced by that separate control**, so no 193→3 s causal speedup is claimed.
- `npm test -- --maxWorkers=2 --minWorkers=2`: **391 tests / 83 files pass**; typecheck/build and diff check pass. New regression tests cover legacy key identity, duplicate/highlight keys, cache-hit progress/mtime preservation and cancellation/resume. Cached marked export text preparation 0.00123 s; contact sheet, home cover and hover strip work, with Arabic/Latin text visually inspected; zero page errors. Evidence/scripts/old implementation/pixel references: `artifacts/qa/task33/` (`render-results.json`, `pixels-results.json`, `cross-run-images.json`, `text-progress.png`, logs). Temporary projects and owned processes removed; only 4496/5296 used. Protected project/style hashes unchanged. No task commit; concurrent styles-window commit `532b7fd` preserved and included in the final checks. Nothing remains blocked; Task 33 only, stop for review.

---

## Task 33 — The «text» stage of a first export (after the night run)

Measured by Claude on `270a811`: a first export of the heavy fixture (121 texts, 10 min) spends about 193 s of 283 s preparing text images, with the progress bar at 0 and the stage «text». A repeat export takes 43 s. Every caption-heavy video pays this once per new or changed text, and the preview export a user makes to check captions pays it too.

Cause (`packages/server/src/textimg.ts:60`): one page, one text at a time, and each one calls `page.setContent` with the whole document, including the `@font-face` CSS with the fonts embedded, then waits for `document.fonts.ready`, then takes a full-frame PNG screenshot.

Do:
- Load the document and the fonts once per batch, then swap only the text layer for each clip. Check that the picture is the same as today (pixel compare on a sample of presets, Arabic and Latin, highlighted captions included).
- Render in parallel on a few pages or browser workers, as graphics capture does (`4018b84`), within a sane limit.
- Report progress during the stage (`ctx.update` with n of total), so the bar moves and says «نصوص 40/121».
- The cache key and the cached file layout stay as they are, so existing caches remain valid.

**Done when:**
- The heavy fixture's cold «text» stage takes under 30 s (it was ≈193 s). Medians of three cold runs, with the stage time now recorded in `timings.text`.
- Images are pixel-identical to the old path for the sampled texts, or the Report shows the differing pixels and why.
- The export shows moving progress during the text stage.
- `npm test`, `npm run typecheck` and the app build pass. Contact sheets and covers (`sheets.ts`) still work, since they use the same function.

**Review by Claude (2026-11-16) — Task 33 accepted.** Same harness as the 282.8 s run (`artifacts/qa/claude-1116/render.mjs`), on this code: heavy full cold 97.2 s (text 2.7 s, graphics 19.9 s, segments 4.0 s, final 69.9 s), warm 46.4 s. So the first export of the heavy fixture went from 283 s to 97 s in the same conditions. Your isolated control of the old function took 10 s, so the old slowness came from the old path under a real export (one shared page while covers and analysis also used the browser), not from the function alone; either way it is gone. Tests and typecheck pass here. What remains in a cold export is the final composition (70 s for 10 min).
