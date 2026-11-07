# SOL — work orders for قَصّة (Qassa)

You (sol) build; Claude is the project manager and reviews your work. The user writes in Arabic; UI text is Arabic.

## How to work

1. Read `CLAUDE.md` (or `AGENTS.md`) first. Then read the end of `docs/IMPROVEMENTS.md` to see how features are written up, and read `brand/README.md` for the design system. Every UI change follows that design system: the tokens in `packages/app/src/index.css` `@theme`, the existing components in `components/ui.tsx`, and RTL.
2. Do the tasks **in order**, one at a time. After each task, check:
   - `npm test`: all pass. A new kind of edit is a new op in `packages/shared/src/ops.ts`, and it needs a test.
   - `npm run typecheck`: clean.
   - `npm run build -w packages/app` (or the app's build script): passes.
   - The feature works in the real editor (`npm run dev`, http://localhost:5173). puppeteer-core plus the system Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`) works for headless checks.
3. **Never touch the user's projects** («صافي», «تجربة», «تجربة-جديدة», and anything in `projects/.trash`). To test, make a temporary project and delete it afterwards.
4. **No git commits.** The repo has no commits yet; Claude or the user will decide.
5. Keep the code style of the file you edit: same naming, same comment density (short "why" comments, no essays).
6. After each task:
   - Add a short entry at the bottom of `docs/IMPROVEMENTS.md`.
   - Add a line under **Report** at the bottom of this file: done / what changed (files) / what you could not do / anything Claude must decide.
7. If a task is unclear or needs a product decision, write the question under **Report**, then do the next task. Don't guess on anything destructive.
8. If you change MCP tool docs or ops, update `.claude/skills/edit-tool/SKILL.md` and its copy `.agents/skills/edit-tool/SKILL.md`. Also update `CLAUDE.md` and `AGENTS.md` when a rule changes.

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
