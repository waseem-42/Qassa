# Editor improvements — 2026-10-28

## Delivered

- Assistant panel for existing analysis suggestions: reason filters, selection, source context, timeline navigation, accept/reject and one-step undo through the existing operation system.
- Before/after main-track duration computed from surviving source intervals, unioned overlaps, playback speeds and repeated footage. Reject batch acceptance that would remove the entire main track.
- Analyze missing source files and show ongoing analysis state. This uses the existing local analysis pipeline; it does not add an LLM provider or a chat endpoint.
- Quick aspect-ratio controls for 16:9, 9:16 and 1:1, with a reminder to review framing.
- Project search and duplicate-submission prevention when creating a project.
- Compact workspace navigation below 1100px so fixed side panels do not hide the viewer.
- Connection status, reconnect cleanup, job refresh, stale-request protection across project switches, project-specific state reset and failed-edit recovery.

## Validation

Run `npm test`, `npm run typecheck`, and `npm run build -w @edit/app`.
New regression coverage checks overlapping suggestion savings against applied edits, source navigation, asynchronous project isolation, failed-edit recovery and reconnect disposal.
Browser checks covered connection recovery, opening an existing project and compact assistant/viewer navigation. No user timeline was changed during these checks.

## Remaining product work

These changes improve the existing editor rather than establish parity with a full production NLE. Provider-backed natural-language planning, automatic subject tracking/reframing, semantic highlight selection and end-to-end quality evaluation of transcription and exported media remain separate work. Existing analysis/render pipelines were not exercised on a new video in this pass.

# Fixes — 2026-10-29

## Export matches the preview

- Layer order: the final pass stacked overlays by start time, so a b-roll or graphic that began after a caption covered it in the export. Layers now stack like the editor: b-roll and graphics in track order, text above them (caption streams included).
- `pop` text animation now renders (it was preview-only): the layer grows from 92% about the frame centre.
- B-roll sound follows the clip's speed (it was missing `atempo` and drifted), is cut to the clip and has click-free fades.

## Stills (PNG/JPG)

- Import: recent ffprobe reports 25 fps for a single PNG, so stills were taken for 0-second videos and landed on the timeline as empty clips. Stills are now detected by their demuxer (`*_pipe`, `image2`) or a missing length.
- A still can be stretched past its 5-second default (`trim` / `set_timing` treated 5 s as the media length).
- `add_clip` refuses empty clips instead of creating them.
- The editor preview shows stills: on the main track (played on the wall clock, crossing to and from video) and as b-roll.

## Smaller

- `speed_range` updates its automatic `x2` label when the speed changes again; a label the user wrote stays.
- Preview: sound effects no longer play twice (once as a one-shot, once through the music element).
- The editor only asks for analysis files that exist (no 404 for a silent clip's peaks).
- `render` refuses an `output` outside the project folder or that isn't .mp4/.mov/.mkv.
- `.claude/launch.json`: `edit-tool-server` starts the API alone, for when the UI is already running.

Tests: 70 (new: speed label, stills, empty clip, b-roll speed, pop, layer order). Checked by rendering projects with captions, b-roll, stills and pop text, and by playing across video/still cuts in the editor.

# Style library gallery — 2026-10-29

- **Pictures:** 940 of 1213 references now carry their upstream preview (HyperFrames posters + 147 preview clips, every Lemo style frame, every Awesome poster). They are linked, not downloaded; `npm run styles:sync` records them, and the current snapshot was backfilled at its pinned revisions (content unchanged).
- **Gallery:** the styles window opens near full screen with a compact tab bar. Cards are 16:9 pictures (a portrait poster sits whole on a blurred copy of itself); hovering a HyperFrames card plays its clip; entries without a picture get a type cover in the brand colours. Pictured entries come first, libraries take turns, and "عرض المزيد" replaces page numbers. Awesome entries show the author and the start of the prompt instead of an id slug.
- **Detail:** large preview (the clip plays) beside the description, tags, links, requirements and the request for the assistant.
- **Brand:** the styles CSS uses the identity tokens (warm inks, `--color-accent`) instead of the purple-grey literals it had.
- API: `/api/style-library` takes `limit` (≤ 60), `sort=preview` and `preview=1`; MCP and tests keep catalog order by default.

# Favourites and style clips — 2026-10-29

- **♥ Favourites:** a heart on every library card, in the details and on each look / saved style. The **♥ المفضلة** tab gathers them (looks first, then references, newest first, searchable). They live in `styles/favorites.json` for all projects, reach every open window over the live socket, and the assistant reads them: MCP `style_library {favorites: true}`, and `styles` marks hearted looks with ♥. API: `GET /api/style-library/favorites`, `PUT|DELETE /api/style-library/favorites/:id`, `favorites=1` on the search.
- **Clips that show the style:** 624 of 1213 references now link one — every Lemo style film (web size, the hover starts at its style frame), 418 Awesome videos (each checked to exist), 147 HyperFrames previews. Hover plays it silently; the details play it from the start with the player's controls (sound, full screen).
- The search keeps the previous cards dimmed while a new one loads, instead of flashing skeletons.

# Export window — 2026-10-29

Compared against DaVinci Resolve's scripting API (`SetRenderSettings`, Quick Export presets, `MarkIn/MarkOut`, `SubtitleFormat`) installed on this machine. Rendering already worked; what was missing was control over the output.

- **Presets:** project settings, YouTube, TikTok/Reels/Shorts (9:16), Instagram (4:5), 4K (H.265), quick review, sound only. Every field stays editable; the last choice is remembered per project.
- **Fields:** file name (saved as `renders/<name>.<ext>`, numbered if it exists), format MP4/MOV/MP3/WAV, frame shape, resolution up to 4K, frame rate, quality (smaller / balanced / best), codec H.264/H.265, captions burnt in / SRT beside the file / both / none, the whole edit or a part (from/to, or from the playhead).
- **After export:** play, show in folder (opens Explorer on the file), save a copy. Several exports queue one after another.
- All of it changes only the render's copy of the project. Shared schema `ExportSettings` + `EXPORT_PRESETS` (`packages/shared/src/export.ts`); the MCP `render` tool takes the same `export` options.
- Caveat: an HTML graphic written at fixed pixels (e.g. `safi-keynote`, 1920×1080) doesn't adapt to another frame shape; the window says so when the shape differs.

Tests: 170 (new: range/H.265/level/sound-only in the compiler, SRT/range/file names in shared, named exports + SRT + private settings on the server, timecode entry). Checked with real exports of «صافي»: 9:16 range (1080×1920, 30 fps, 5.0 s), MP3 (10 s), and 4K H.265.

# Magnet and clip properties — 2026-10-29

- **Magnet (N, button in the timeline toolbar, remembered per browser; hold Alt to let go for one drag):** on the timeline a moved clip catches by whichever edge is nearer the playhead, another clip's edge or a comment, live while dragging; trims catch too, and the playhead catches on cuts while scrubbing. A gold line shows what it caught. On the preview, text, graphics, regions and b-roll catch their edges/centre on the frame's edges, centre and thirds, with guide lines; resizing a graphic catches at full frame. Logic in `packages/app/src/lib/snap.ts`.
- **Sliders:** click the number to type a value in the units shown (50 for 50%, Arabic digits accepted), Enter/Esc; double-click the slider to reset.
- **Picture (`clip.picture`, Resolve's Transform/Cropping/Composite):** fit (fill, or the whole picture on black bars), rotation, flip, crop per side, and for layers above the main track opacity. B-roll gets picture-in-picture through `place` (size, position, corner presets) and can be dragged/resized on the preview. Same result in the preview (WebGL view + CSS; `object-view-box` for b-roll crop, Chromium) and the render (crop → flip → fit/fill → size → rotate → opacity → placed about the centre).
- **Sound fades per clip (`fadeIn`/`fadeOut`):** main, b-roll and music; heard in the preview too.

Tests: 179. Checked by rendering a test video with every picture setting (cropped/fitted/rotated main + rotated, see-through corner b-roll), and in the browser: snap guide on the timeline (project untouched), the picture section and typed values in the inspector.
Not yet: blurred background for "fit" (bars are black), opacity on the main track, keyframes for anything but zoom/position, freeze/reverse/detach audio, copy/paste attributes.

# Editing tools (CapCut toolbar) — 2026-10-29

- **Blurred bars (`picture.bars: 'blur'`, main track, with fit):** a wide shot in 9:16 sits on an enlarged, blurred copy of itself. Render: split → small cover copy blurred in RGB (blurring 4:2:0 chroma at the same radius as luma mixed colours wrongly — caught on colour bars) → the fitted picture (turned on its own when rotated) laid in the middle. Preview: the drawn frame copied into a small canvas behind it and blurred by CSS.
- **Freeze frame:** the frame under the playhead becomes a still (`source/edits/*-frame-*.png`, a media with `derived: {kind:'freeze'}`) held for 2 s; op `freeze_frame` splits the clip and puts the still between, keeping the zoom of that moment, grade and picture. On V1 everything after moves later; on a layer only the rest of that clip.
- **Reverse:** a job renders the clip's part backwards, sound too (`areverse`), in pieces of a few seconds so `reverse` never holds a whole clip in memory, then joins them (`source/edits/*-reverse-*.mp4`, `derived: {kind:'reverse'}`) and swaps it in with op `replace_media`. Back to forwards — or the same part again — is instant. The reversed copy gets its own proxy, waveform and filmstrip.
- **Detach audio:** op `detach_audio` puts the clip's sound on a free audio track (a new `A3`… when the others are busy) with the same timing, volume and fades; the clip goes silent. The preview now plays up to three sounds on audio tracks at once.
- **Copy / paste the look (Ctrl+Alt+C / Ctrl+Alt+V, buttons in the inspector):** colours, zoom and its keyframes, picture, volume and fades (a layer's place onto other layers); a text's style onto other texts. Logic in `packages/app/src/lib/look.ts`.
- Fixes found on the way: split tails kept keyframe times of the whole clip (zoom jumped); neighbours with different pictures or fades were merged back into one clip; stills showed nothing on the timeline.
- MCP: `freeze_frame`, `reverse_clip`; `edit` documents `detach_audio`, `replace_media`, `picture` (bars).

Tests: 193 (ops freeze/detach/replace/merge, compiler blurred bars + unique labels across a transition, server freeze/reverse on a real video checked by colour and length, paste look). Checked with a real export of a test project using all of it (1080×1920, 10 s: detached sound plays, held frame silent) and in a headless browser: every button, the keys and the timeline.
Not yet: opacity on the main track, keyframes for anything but zoom/position.

# Keyframes, clip menu, clipboard, loudness — 2026-10-29

- **Keyframes on more than zoom (`clip.anim`: dx, dy, scale, opacity, volume → `[{t, v}]`, t from the clip start, smoothstep like zoom):** a picture-in-picture or graphic that slides, grows and fades in; a main clip that fades from black (opacity on V1 is now supported, over black); volume that dips under a line. In the inspector each of these sliders has ◆ (key at the playhead / remove it) and ‹ › (previous / next key); with keys, moving the slider — or dragging the layer on the preview — sets the key at the playhead (`packages/app/src/lib/anim.ts`). Keys show as diamonds on the timeline clip (click = jump there). Split tails and freezes keep the motion right; copy/paste look carries keys.
  - Render: position as overlay x/y expressions of t; a changing size scaled per frame and padded to its largest (ffmpeg's overlay keeps the first frame's size otherwise — checked); opacity by `sendcmd` files setting `colorchannelmixer` per frame (`cache/anim/<content hash>.cmd`, written before the segments); volume as a `volume` expression. Preview follows the same values each frame.
- **Loudness kept fades:** the final pass used loudnorm in one-pass (dynamic) mode, which pulled every quiet part back up — fade-outs, volume keys, lowered music sounded the same as the rest. Now a quick sound-only pass measures the whole mix and the final pass applies that one gain plus a limiter (−1.5 dBFS). Measured: a volume key 1→0 now falls −12 → −19 → −38 → −70 dB; the edit still lands on −14 LUFS.
- **Right-click a clip on the timeline:** split, copy, paste, duplicate, copy/paste look, freeze, reverse, detach audio, delete — with each shortcut shown (`ClipMenu.tsx`).
- **Clips clipboard:** Ctrl+C / Ctrl+V (at the playhead: layers keep their spacing; main clips go in at the nearest cut) / Ctrl+D (right after). Ctrl+C with text selected on the page still copies the text.
- **Save frame (camera button in the transport):** the frame at the playhead at full size, composited like the export — for thumbnails. `GET /api/projects/:name/frame?t=`.
- **Contact sheets match the render now:** crop/flip/fit/blurred bars/rotation/opacity, picture-in-picture at its place and size, keyframes at that moment. Also fixed: a frame whose pixel format differed (opacity) was silently dropped from the sheet.
- Small: more speeds (×0.25, ×3, and whatever speed the clip already has); blurred bars keep the same softness at any size; colour tokens that did not exist (`ink-100`) in the new styles.

Tests: 202. Checked with a real export of the test project (fade from black, moving/growing/fading PiP, volume dip) side by side with the preview at the same moments, a contact sheet of the same moments, a full-size saved frame, and in a headless browser: ◆ and ‹ › in the inspector, timeline diamonds, the right-click menu, Ctrl+C/V/D and undo.

# Editable graphics, project covers, AI task router — 2026-10-29/30

## Graphics without the AI

- **Elements inside a graphic** (`clip.graphicEdits`): «عناصر الرسمة» → pick any text or shape on the preview (hover outlines, click selects, drag moves), then change its text, colour, background, size, place, or hide it. Edits are laid over every frame by `GRAPHIC_RUNTIME` (restored before each seek, applied after), so they win over the page's own animations; the editor sets them live without reloading the page, the renderer gets them in the URL.
- **Scenes** (`clip.retime`, op `retime_graphic`): a graphic whose `template.json` lists `scenes` gets a length per scene in the inspector and draggable dividers on its timeline clip; the scenes after follow, pieces of a split graphic stay together. `split` pins the page length so both pieces still play one page.
- **Entrance / exit presets** (fade, slide, zoom, pop) for graphics and b-roll, as keyframes.
- Project graphics can carry a `template.json` like the library (data, Arabic `labels`, `scenes`) and `data-edit` names; the runtime sets the theme as CSS variables. صافي was rewritten this way (follows the project accent).
- Colour fields (swatch + hex) for any colour in graphic data.

## Project covers

- `GET /api/projects/:name/cover.jpg` and `strip.jpg` (composited like the render, cached in `cache/covers/` until the project changes, made one at a time). Home cards show the cover at the project's shape over a blurred copy, scrub a 10-frame strip on hover, show duration and «مُصدَّر». «اجعلها غلاف» (next to the camera) sets `settings.cover`.

## AI task router

- «اطلب من الذكاء» in the assistant panel runs a request as a headless `claude -p` session with the edit-tool MCP server. Rules in `shared/src/router.ts` pick the tier as you type (quick = Haiku/low, standard = Sonnet/medium, deep = Opus/high); requests no rule fits are classified by Haiku (< 1¢). The estimate and the hard cap (`--max-budget-usd`) show before running; the tier can be changed.
- Tasks run on their own queue (an agent may start a render through MCP and wait for it), stream their steps, and show the reply and the real cost; every task is logged in the project's `ai-tasks.jsonl` with a running total.
- Verified: a quick task (add a text) took 8 s and cost $0.009.

# Comments the AI acts on — 2026-10-30

- Every open comment has «نفّذ · <tier>»: it starts an AI task on just that comment (the tier comes from `routeNotes`, the tooltip shows the model, estimate and cap). «نفّذ كل المفتوحة» does all open ones in one task. While a task runs the comment shows its steps and a stop button; the comment stays in the list after the AI closes it, so its reply is seen.
- «نفّذ كل تعليق جديد تلقائياً» (`settings.aiNotes`): the server starts a task for each new user comment (comments that need the deep tier wait for a click). Tasks on the same comment are not started twice.
- The task prompt names the comment ids: read them with `notes`, act, close each with a reply in the same batch, reply without closing when unclear.
- Verified in the editor: «حط نص «مرحبا» هنا» and (automatic) «غيّر النص إلى «أهلاً»» — Haiku, ~8 s, $0.009 each.

# Library templates editable without the AI — 2026-10-30

- Every element of the library templates (steps, chapter, compare, keys, callout) has a `data-edit` name (`kit.el(tag, cls, text, name)`), so hand edits find it by name instead of by its place in the page.
- Their scenes depend on the data and the length (how many steps, the stagger), so the page declares them: `kit.scenes([[name, start], …])` sets `window.__graphicScenes` (the exit is added). The editor reads them by loading the page once, hidden (`useScenes`, cached per URL); a `scenes` list in `template.json` still wins. The inspector's «المشاهد» and the dividers on the timeline clip work for library templates now.
- `template.json` has Arabic `labels` for the data fields and an Arabic `about` shown in the inspector (`description` stays for Claude).

# New-user pass — 2026-10-30

Walked through as a new user on a fresh project (new project → drop a talking video → analysis → cuts → captions → graphic → export) and fixed what got in the way:

- **Graphics by hand**: «رسمة» in the timeline toolbar lists the library templates (Arabic `name` + `about` from template.json) and the project's own graphics; picking one puts it at the playhead on V2, selects it and opens its properties. Before, only the AI could place one.
- **Ready cuts first**: the assistant panel opens with «قص جاهز من التحليل — مجاني» (all suggestions ticked, the saving shown at once, «قص المحدد»), then the AI box, then the analysis state (only while it matters) and the frame shape. Before, suggestions sat under the paid AI box with nothing ticked.
- **Free before paid**: «كابشن من الكلام · مجاني» sits with the AI ideas (it was a paid idea chip, while the free button was in project settings); «نفّذ التعليقات» only shows when there are open comments.
- A track that was just added (captions, SFX) scrolls into view in the timeline.
- The red suggestion count on the «الخصائص» tab is gone (the same count is on «المساعد»).

# Scene hold, ruler, keyframe curves, voice cleanup — 2026-10-30

- **Longer scenes hold instead of slowing down** (`Retime.hold`, `retime_graphic {hold:true}`, what the editor sends): a scene given more time plays its motion at normal speed and then stays on its last frame; a shorter one still plays faster. Edges still map to edges, so split pieces stay together.
- **The timeline ruler stays on top** when the track list scrolls (it lives in the sideways scroller, so it is moved by hand with the vertical scroll).
- **Keyframe curves** (`anim` keys take `ease`: smooth (default) | linear | in | out | hold): «منحنى» under a keyed slider when the playhead is on a key that has a next one. Same curve in the preview (`ease()` in shared) and the render (`keyExpr`); a test runs the ffmpeg expression against the editor's numbers.
- **Voice cleanup per clip** (`clip.denoise` 0..1, `update_clip {patch:{denoise}}`): a high-pass under the voice and `afftdn` noise reduction that tracks the background, 6–30 dB by strength, applied to the clip's sound in every render path. «تنقية الصوت» in the clip's properties with «▶ الأصل» / «▶ بعد التنقية» (a few seconds from the playhead, `POST /clips/:id/denoise-preview`, cached in `cache/denoise/`) and «نفس التنقية لكل لقطات هذا التسجيل». Copy/paste look carries it. The live preview plays the sound as recorded.

# Where things stand — 2026-10-30 (end of day)

- 212 tests pass, typecheck clean, the editor builds. Nothing is committed yet.
- Start with `Start-Qassa.bat` (or `npm run dev`); restart Claude Code so its MCP server has the new tool docs.
- Cleanup: the test projects made while building were deleted; `artifacts/` became `docs/` (api, research, history); AGENTS.md and the Codex skill copy were brought in line with CLAUDE.md and the Claude skill.
- Open ideas: AI b-roll, continuity checks (zoom curves and live voice cleanup were done after the restart, below).

# 2026-10-30 (after the restart)

- **Zoom keys have curves too** (`transform.keyframes[].ease`, same values as `anim` keys): «منحنى» under «زوم وكاميرا» when the playhead is on a zoom key that has a next one. `transformAt()` and the renderer's `kfExpr` use the same `ease()`; editing a key at the playhead keeps its curve (`withZoomKey`). The curve row is one component (`EaseRow`) for both.
- **The playhead's head stays on the ruler** when the track list scrolls (it is a `data-ruler` piece, moved with the ruler).
- **Voice cleanup is heard in the live preview**: each preview element plays through high-pass → `qassa-denoise` AudioWorklet → gain (`lib/audio.ts`, `setDenoise`). The worklet is a downward expander under a noise floor it learns as it plays (quietest 100 ms of the last 3 s, pauses left out), taking off the same 6–30 dB as the render's `afftdn` — close, not the same filter; «▶ بعد التنقية» still plays the exact render. Checked on synthetic noise + voice: noise −18 dB at 50% / −30 dB at 100%, voice −0.1 dB, still working after a pause.
- 213 tests pass, typecheck clean, the editor builds. Restart Claude Code once more so its MCP server accepts `ease` on zoom keys.
- **AI b-roll as ideas you review** (`project.ideas`, ops `add_ideas` / `resolve_ideas`, `shared/src/ideas.ts`): the AI reads what is said and proposes visuals — `graphic` (a library template filled from the words), `text` (a few words on screen), `broll` (part of a b-roll media in the project, looked at first), `shot` (footage the project lacks: what to film and English stock-search words). Each is pinned to its words' source seconds, so it follows any cut (`ideaSpan`); nothing touches the timeline until the user says. «أفكار بصرية» card in the assistant (one button «اقترح بي-رول وشروحات» = a standard-tier AI task with `AgentRequest.ideas`, its own prompt in `agent.ts`; per idea «أضف» / «تجاهل», and «أضف الكل»), dashed marks on the first b-roll track (click = the card). Adding places each on a free overlay/text track at its words (a new «بي-رول 2» track when V2 is busy there), b-roll silent under the voice, a `shot` becomes a comment with the search words. Pending ideas are listed in `project_summary`; the skill tells Claude when to propose instead of placing.
- **The editing page, tidied to the identity** (design system: header 48px, tools 400px beside the rail, media 290px across the video): one way between panels — the rail (its buttons toggle; counts of waiting suggestions/ideas and open comments sit on them); the duplicate tabs inside the panel are gone. Tools and media panels open side by side from 1600px wide (`BOTH_PANELS`), below that opening one closes the other; which are open is remembered (`panels` in the store, `showPanel`). The «معاينة المشروع» row and the status bar are gone: aspect · resolution · fps and the wide-preview button live in the transport bar, the connection shows in the header only when it drops. Play is light, not gold (gold = export, the one primary action). Rail labels 11px. Video area: 1366×768 went from 503×283 to 670×377; 1920 with both panels 1108×624 (was 1056×594 with one).
- **Properties in short tabs** (`Inspector.tsx`): a clip's panel was one column of 1,260–1,640px (everything at once); now a header says what is selected (name, length, where it plays from, freeze / reverse / detach audio / copy look / delete) and its properties sit in tabs by what they touch — video or still: «الصورة» (zoom & focus, or size & place for a layer; fit, opacity, rotate, flip; cropping folded) · «الألوان» · «الصوت» · «الوقت» (speed buttons, timing, transition or entrance/exit); text: «النص» · «الوقت»; graphic: «المحتوى» · «المكان» · «الوقت» · «الهوية»; project: «المشروع» · «الهوية» · «الألوان» · «المؤثرات». Most tabs fit without scrolling at 1440×900. Each kind of clip remembers its tab. Sliders are a quiet track filled in accent-dim with a light thumb (gold only as the focus ring); row labels sit level with the first line of their control; template choices (start/top/box…) show in Arabic; Latin values (60 fps, −14 LUFS, 2×) keep their order. Selecting a clip opens its properties even when the tools panel was closed. The duplicate list of cut suggestions in project settings is gone (they live in the assistant).
- **The identity section says what it does** («الهوية», project and graphic tabs): a live sample (a title and a label drawn with `textLayerHtml`, as the export draws them); what follows it now and what doesn't — texts with their own colour / background / font (button «خلّها تتبع الهوية»: `update_clip` textStyle `color|background|font: null`, new) and project graphics with colours written into the page (server `/graphics` reports `themed` / `themedFont` per own graphic; button «اربطها بالذكاء» starts a standard-tier task that swaps them for the theme variables); presets as small samples; colours named by what they colour; the font is a choice of seven Arabic fonts shown in themselves (`THEME_FONTS` in shared: IBM Plex Sans Arabic, Cairo, Tajawal, Almarai, Changa, Reem Kufi, Lalezar — @fontsource packages, served together in `/api/graphics/fonts.css`, linked by the editor and used by text renders and graphics, so preview and export match). `graphic_preview` tells Claude when a project graphic ignores the identity.
- **Tokens per AI task**: `claude -p`'s `usage` (input, output, cache read, cache write) is kept with each task (`AgentResult.usage`, `ai-tasks.jsonl`) and shown in «المساعد»: under a finished task «Opus · 32.7k كتابة · … · 5.5 د», and in past requests next to the cost (the full line on hover). The 5-hour limit counts tokens, not dollars, so tasks can be compared by what they used.
- **Clips move between the main track and the others** (op `move {trackId, index?}`): drag a main-track video or image up onto a b-roll track and it leaves the main track at the time you drop it (the main track closes up, free clips stay on their content, its transition goes); drag a b-roll picture down onto the main track and it joins it where you drop it (its picture-in-picture place goes). The track under the pointer lights up with a dashed box where the clip lands; a drag along the main track that changes nothing says how the magnetic track works instead of doing nothing. Text may go on text or overlay tracks, graphics on overlays, sound on audio tracks.

# Sound waves without full analysis — 2026-10-30

- Missing peaks are generated on demand through streaming ffmpeg PCM (50 Hz, 99.5th-percentile normalization), cached at the existing analysis path and broadcast live, independent of Python/Whisper or analyzed flags.
- «الموجة» / Shift+W (rebindable) enlarges V1 and gives half its height to sound, remembered per viewer. Token colours distinguish source/overlay/music; amplitude follows volume keys and fades, muted tracks dim.
- Verified: 222 tests, typecheck, build; isolated real Chrome video/music import with analysis disabled, toggle, shortcut and amplitude changes. User projects untouched.

# Trash retention and permanent deletion — 2026-10-30

- Trash cards show days remaining and a named irreversible «حذف نهائي» confirmation; «إفراغ المحذوفات» confirms the project count.
- UUID/path/link/tree-checked DELETE routes remove one or all envelopes, including restored records, refusing busy names. Startup and every six hours purge entries older than the shared 30-day retention constant. Permanent deletion stays outside MCP.
- Verified: 226 tests, typecheck/build and isolated Chrome confirmations/delete/empty. All tests used temporary roots.

# Reusable identity uploads — 2026-10-30

- Identity tab uploads document/token/image/PDF/ZIP kits, stored globally in brands/<uuid> with originals, logos and fonts. Local parsing extracts CSS/JSON/Markdown/HTML values; capped ZIP extraction uses generated asset paths.
- Review swatches, map colours, choose font/direction and apply theme + settings.brand in one undoable settings op. Applied/saved kits stay visible, manual controls fold away, ThemeReach stays.
- Brand fonts join the same font pipeline for editor and export. MCP `brands` exposes palette/logo/voice. Optional quick AI reading shows estimate and cap, is cancellable and logged; paid model quality was not exercised in tests.
- Verified: 232 tests, typecheck/build, isolated Chrome upload/map/apply/undo and real custom Arabic font loading from ZIP.

# Manual grading removed — 2026-10-30

- Removed clip/project colour tabs and unused grading controls. Existing grades/LUTs, styles, renderer and MCP edits remain supported.
- A clip using grading shows «عليه تلوين — إزالة». Removal also handles inherited project grades without altering other clips.
- Verified: 232 tests, typecheck/build, isolated Chrome grade summary/removal and tab absence.

# Project style provenance — 2026-10-30

- project.stylesUsed and undoable log_style keep one row per style id with name/source/time/author/purpose. Applying a look logs in the same batch; MCP style_reference accepts project/what to log a working reference.
- Project properties list used styles and open them in the library; looks/references show «مستخدم في هذا المشروع». A user reference request logs alongside its comment.
- Verified: 233 tests, typecheck/build, isolated MCP logging/deduplication and real Chrome deep link/badge.

# Styles discovery and global recent history — 2026-10-30

- «الأخيرة» groups the latest 50 style/project uses and detail opens by day, with reuse and per-row/all history removal. Project stylesUsed remains independent and undoable.
- Category chips and segmented sources, sticky search, source labels, used-here badges and detail project history. Arrow navigation follows RTL grids; Enter opens and Esc closes. Offscreen previews pause and unload; layouts checked at 1440px and 390px.
- Final QA also fixed font export: text-render pages embed the fonts they use because originless pages cannot load file URLs. A real Chrome test covers this; custom Arabic ZIP fonts load in both preview and the rendering browser. Clearing a grade over a project look clears any old LUT.
- Verified: 236 tests, clean typecheck, app build, and isolated end-to-end Chrome + MCP for all six SOL tasks. Before/after screenshots and remaining paid-AI verification limitation are in SOL.md Report. No user project or trash modified, no commits.

# Projects page: projects first — 2026-11-03

- With projects, the home page opens on a short «مشاريعك» bar (count, last edit) with one «مشروع جديد» button that opens an inline name field (Esc cancels), then a «واصل من حيث توقفت» card for the most recently edited project, then the library. The big welcome + create card only shows when there are no projects.
- Card dates are relative («قبل ٤ دقائق»), full date on hover. `ProjectMeta` is shared by the card and the resume card.
- Checked headless at 1400px and 390px: no page errors, no horizontal scroll. UI only (`Home.tsx`, `index.css`), no server change.
- Start from a video: drop video/audio anywhere on the projects page (full-page dashed overlay) or use «ابدأ من فيديو». It creates a project named after the file (made safe for the server's folder-name rule, `-2`… if taken), uploads the files as `source` (they go on V1 and analysis starts as usual) and opens it. Tested headless with a generated clip; the test project was removed.
- Project cards show what the server is doing for them: the running (or queued) job's label, its % and a thin progress bar, `+N` when more are waiting; AI tasks read «مساعد AI يشتغل». Store keeps `activeJobs` for every project (loaded from `/api/jobs`, kept live from the `job` socket messages).
- Projects with no picture get their name's first letter on a tint chosen from the name (accent, note and clip colours), so empty projects tell apart.

# Any project name, sound-only main track — 2026-11-05

- New project names may hold any characters (brackets, punctuation): the folder gets a safe name (`folderName` in `Home.tsx`, shared with «ابدأ من فيديو»), the typed title is kept as the display name (`create(name, displayName)` in the store → PATCH after create).
- A podcast / voice-over on the main track no longer hangs the viewer on «يجهّز المقطع…»: audio media on V1 is a playable segment with a black picture (`Seg.audio` in `Viewer.tsx`), renders over a black `color` input at the output size (`blackInput` in `compile.ts`, transitions included) and contact sheets show black for it (`sheets.ts`). Test: «a sound-only main track (a podcast) plays over black».
- Three comparison scenes made by Claude on the user's podcast (`projects/يار-بودكاست-تبصر/graphics/faragh-*`): Engineering Briefing Board, Archive Light Table, OneTake.

# Import without roles — 2026-11-05

- Drop files anywhere in the editor; ordered per-file XHR upload progress and cancellation, automatic role and timeline placement. Roles remain editable via undoable update_media, independent of placed clips.
- Media cards drag to timeline tracks with a dashed landing preview, nearest V1 boundary or exact free-track time; dropping below tracks creates a matching track. OS track drops use the same placement after upload. Filenames cannot overwrite previous uploads.
- Verified: 240 tests, typecheck/build and isolated real Chrome OS drop, video + music placement, V2 at 12 seconds, role change without movement, new-track drag and queued/active upload cancellation. Background Python deliberately disabled only in the isolated browser fixture; no user project touched.

# Sound without picture — 2026-11-05

- Clip inspector/menu «صوت فقط» toggles picture.off through update_clip, retaining timing, framing and sound. V1 renders black beneath the overlays; an overlay contributes sound without a picture. Timeline shows a full wave without thumbnails.
- Media-card menu «أضف الصوت فقط» places video sound on a free audio track at the playhead; video drops on audio tracks work. MCP and both skill docs describe it.
- Verified: 243 tests; typecheck/build, real CPU exports and contact-sheet pixels for V1/overlay/audio; isolated Chrome black canvas, actual MP4 audio measured through Web Audio, inspector toggle and media action.

# Flexible story tracks — 2026-11-05

- Timeline «+ مسار» adds overlay, text or voice tracks. Headers rename, reorder, toggle music/voice and delete (populated tracks require a counted confirmation). All edits are ops and undoable; V1 stays first, cannot be removed, and reads «الأساسي» with a tooltip.
- track.audio defaults to music for existing projects. Voice tracks keep user levels/fades without automatic fades or ducking, and join V1 in the music compressor's key. Live preview uses RMS speech metering and the render's threshold/ratio/attack/release; dynamic elements replace the old one-overlay/three-audio ceiling. Layer order now agrees across preview, export and sheets.
- New-project and empty-editor starts: video, voice/podcast (two visual tracks), empty (V1 only). Shapes only choose tracks; empty-editor switching is undoable. Audio-spine projects open with a large wave. Text and graphic insertion create suitable tracks when needed; source-range selection reads actual tracks instead of assuming V2.
- Fixed export preflight's stale rejection of an audio spine and unnecessary visual LUT dependencies on sound-only clips. Sound-only overlay speech also keeps its level and participates in music ducking.
- Verified: 253 tests in 36 files, typecheck and app build; real CPU audio-frequency checks prove steady voice onset and bed ducking, decoded pixels prove overlay reordering matches sheets, isolated real Chrome exercises track management/delete+undo, Home/empty starts, audio-spine export readiness, two visual layers and four simultaneous voice tracks. MCP smoke passes. SOL.md holds screenshot paths and QA limits. No user project or trash changed; no commits.

# Play any timeline; transcription only on request — 2026-11-05

- Viewer runs on wall time wherever no V1 segment covers the playhead; empty V1, gaps and trailing audio/visual layers play over black. SFX now follow the same transport instead of uninterruptible one-shots. Empty prompts no longer claim to prepare audio or idle files.
- Export compiler pads the base with silent black segments to the last clip on any track, including gaps. Playback, ranges, export readiness, Home duration and covers use projectDuration.
- Upload/default analysis never invokes Whisper, including the Python CLI default. Energy-based silence detection remains. Media cards and transcript empty state offer «فرّغ الكلام»; captions, retakes/word editing, ideas and note context show transcript requirements. Requested word work through MCP explicitly asks for transcription and reports why.
- Captions include speech on audio tracks and preserve existing captions when transcripts are missing. Media role inference respects audio-track music/voice placement. UTF-8 upload tests retain the entire filename including 🎙️【302】 تيك توك.wav.
- Verified: 256 tests, typecheck/build, MCP smoke and real Chrome with the actual preparation pipeline. Cached medium Whisper ran offline only after clicking the explicit button, produced 19 words from synthetic speech, and UI captions worked on A2; no Whisper job on audio/video upload. Real CPU export tests decoded both sounds over black with empty V1 and layers past V1. All fixtures temporary; user projects untouched.

# In/Out marks and mouse selection — 2026-11-05

- Project settings.marks stores absolute timeline In/Out; undoable set_marks sets/clears them and swaps reversed pairs. Physical, rebindable I/O, Alt+I/Alt+O/Alt+X and Shift+Space appear in the shortcuts sheet. V1 edits do not re-anchor marks.
- Sticky ruler brackets snap to clips, playhead and comments. The span is tinted, the outside dimmed across tracks, and the toolbar shows duration and clear. Dragging the ruler sets the range; clicking seeks. Empty-track rubber bands select touched clips across rows, Shift adds, Ctrl toggles, Alt marks a time span. Fast pointer releases commit the final position rather than the prior rendered frame.
- Export opens on the marks with «من العلامات I/O». MCP render marked:true captures the checked snapshot's range; project_summary and both skill copies describe it. Shift+Space stops at Out. With no clips selected, Delete ripple-deletes the span across every track and clears marks in one undo batch, after a first-use destructive hint; source speeds, free-layer splitting and comment timing are handled by delete_range.
- Verified: 261 tests in 40 files, typecheck/build and MCP smoke. Isolated Chrome exported 10..25 directly from I/O to a real 15-second MP4, and exercised range gestures, snapping, Arabic physical keys, selection modes, bounded playback, destructive hint/undo, existing clip drag and sticky ruler after scrolling. SOL.md records screenshots. No real user projects/trash changed; no commits.

# Windows desktop package — 2026-11-06

- packages/desktop wraps the server-served app in Electron with a single-instance lock, free port, health-gated startup, .port discovery, logging and bounded crash recovery. Windows Job Objects clean up the complete server/Python/ffmpeg tree even after a crash. Jobs persist and interrupted work returns as an explicit failure.
- EDIT_DATA_DIR separates projects, brands, styles/history/favourites, SFX, runtime caches and logs from read-only EDIT_RESOURCES_DIR. Desktop defaults to Documents/Qassa; development retains repository defaults. Packaged server/MCP are plain JS, with Node supplied by Electron. Chrome/Edge remain the graphics browser. ZIP kits no longer require Python.
- Settings offers first-run Python 3.11/Whisper/OpenCV/scenedetect/numpy/CUDA/model download, estimated size, phase/byte progress, pause/resume/retry, CPU fallback note and Claude CLI status/registration command. Editing and export work before analysis setup finishes. Bundled MCP reads .port on every request and never launches a second desktop server.
- npm run desktop and npm run dist:win produce a per-user NSIS Qassa-Setup.exe; no auto-update or automatic migration. FFmpeg is pinned and SHA-256 checked, with GPL notice/source and font licences. docs/desktop.md records packaging and release-source requirements.
- Verified: 265 tests, typecheck/build, dev smoke and a real packaged app with no Node/Python/ffmpeg on PATH. Complete first-run downloads, large-v3 CUDA transcription (15 words), Edge library-graphic MP4 export, crash/job recovery, MCP port changes and process-tree cleanup passed. Fresh-Windows-profile installer acceptance remains untested; current installer is unsigned and unpublished. User projects/trash unchanged.

# Captions follow their source words — 2026-11-06

- Generated captions persist clip.words with mediaId/from/to and an occurrence clipId. Source cuts, deletion, trimming, movement and speed changes update/remove captions in the same undo step, with local split/merge lineage. Partial removal shrinks or splits the text; unchanged words preserve manual wording. Free-track speech is supported, and captions cannot hold past their source end.
- Word-bound captions no longer collapse onto generic V1 deletion anchors or undergo a second generic ripple trim. Rebuilding kept source ranges preserves links and avoids identical duplicate lines. Plain/legacy text remains independent; regenerate legacy captions to add links. Missing transcripts are never reconstructed from guessed text.
- Export preflight warns when caption clips on one visible track overlap. Verified: 272 tests, typecheck/build and MCP smoke; real Chrome source deletion + one-step undo, partial cuts against an actual Whisper transcript, and the overlap warning in Export. Desktop installer rebuilt with the fix. No user projects/trash changed.

# Timeline cursor separate from export marks — 2026-11-07

- User correction to Task 11: setting In/Out in the UI is keyboard-only (rebindable I/O). Ruler clicks and drags scrub the playhead immediately, without snapping back to its previous position, changing project history or setting a render range. The brackets display marks only and let pointer events reach the ruler. Empty-space bands, including Alt-drag, select clips; Shift-add/Ctrl-toggle remain available. The explicit clear button and clearing shortcuts remain.
- Updated shortcut help, both skill copies, CLAUDE.md/AGENTS.md and the Task 11 requirements so the old mouse-range gestures are not reintroduced. Windows patch version is 0.1.1.
- Verified: 272 tests and typecheck, app build, and real Chrome on an isolated temporary project. Clicks, live scrubbing, small pointer jitter, dragging over a bracket and Alt-bands never changed marks or created edit requests; I/O did, Export kept the saved 10..25 range, and Alt+X/reload worked. User projects/trash untouched.

# Draggable playhead and separate export grips — 2026-11-07

- User clarified that both controls should drag: the playhead line/head now have pointer targets and snap to fixed clip edges/comments, with no self-snapping. The final project edge can be reached exactly. N toggles magnet snapping, Alt releases it temporarily, and grabbing off-center preserves the pickup offset.
- A separate upper lane holds draggable I/O grips; the lower ruler only scrubs. Default 0/end grips appear before any marks are saved, and the first drag creates a range. I/O drags preview without moving the playhead and commit one undo; ordinary ruler/empty-band gestures never change export marks. Updated help and both instruction/skill copies; Windows version 0.1.2.
- Real isolated Chrome verified head/line dragging, snaps on main/overlay/audio/final cuts, comments, Alt/N, default range creation, independent I/O grips, off-center pickup, undo, sticky hit targets and Export values. The earlier keyboard-only rule is superseded by this explicit separation of controls. User projects/trash unchanged.
- Final checks: 274 tests in 43 files pass, typecheck clean, production UI and Windows 0.1.2 installer builds pass. Packaged UI matches the tested build; coincident cursor/mark controls remain independently usable after scrolling. Installer checksum refreshed beside Qassa-Setup.exe. SOL.md records the transient timeouts under concurrent compression and successful complete rerun.


# Practical timeline and media placement — 2026-11-07

- One shared placement rule keeps UI drops, source ranges, moves, paste/duplicate and nudges from covering existing free-track clips: reuse a free compatible span, otherwise another layer, otherwise create one above the target. Voice/music routing stays intact. Existing/MCP overlaps remain supported and carry visible stripes plus an export warning.
- Taller persisted dock, six visible normal tracks by default at 1600x1000, compact/normal/large rows, native Ctrl+Shift+wheel sizing, Shift+F maximise/restore, readable 150px heads and inline rename. Captured drags survive leaving the timeline; Esc cancels, edge scrolling follows pointer/media drags, and release commits the final preview. Selected free clips move together with outer-edge snapping and one undo; comma/period move a frame, Shift ten.
- A ghost shows each media destination, including a new layer above an occupied row, snapping, invalid targets and insertion between rows. External-file duration stays explicitly provisional until probing; actual placement is rechecked by the server. The 56px media cards expose usage counts, duration, thumbnail hover scrubbing, video double-click source selection and hover add; less common actions are under options. Shift+A adds selected media safely.
- Verified: 281 tests, clean typecheck, production UI build and isolated real Chrome exercising placement, group moves/undo/nudge, viewport persistence, row sizing, pointer capture/cancellation, edge scrolling, thumbnail scrubbing, OS uploads and overlap warnings. The cursor/I/O regression suite passes too. Windows version 0.1.3; SOL.md records screenshots and package verification. User projects/trash unchanged.

- Windows 0.1.3 installer built successfully, executable version and packaged UI hash checked, SHA-256 refreshed. Extra Chrome regressions passed V1 reorder, mixed selections, trim capture/cancellation and release outside. Compact header controls stay inside their rows. See SOL.md for final installer size/checksum and QA scripts.

# Smaller MCP sessions and safer speech editing — 2026-11-07

- MCP hides the internal restore_project op (checkpoint_restore remains), and shared JSON schemas use local references. Measured compact UTF-8 tools/list falls from 78,148 to 52,846 bytes; edit input schema from 47,511 to 22,158 bytes. Runtime Zod validation remains in place and schema-reference validation is tested.
- render_preflight returns readiness, revision, blockers/warnings and resourceCounts by kind; only non-ready resources are listed unless verbose:true. media_import returns media, jobId and job, with optional wait up to 50 seconds and null when no analysis is queued. Imports still never transcribe.
- add_clip accepts overlay/audio/text as a track kind, or free:true with an explicit track ID; move supports the same opt-in routing. Both use the existing free-track planner, including voice/music routing and track creation in one undo. Explicit IDs remain permissive by default, while edit immediately names new/enlarged overlaps and suggests free:true.
- cut_words clamps breathing pads outside removed words and reduces long pauses across the edit to 0.12 seconds, reporting the adjustment. It also removes speechless islands left beside the phrase by earlier silence cuts. Transcript gaps over 0.6 seconds supplement energy-based silence suggestions without duplicates. Caption chunking balances orphan words while preserving source occurrences and exact word links.
- Verified: 290 tests in 47 files, clean typecheck, production app build and MCP smoke including real import jobs, safe add/move/undo, overlap notices, linked captions, compact/verbose preflight and adjacent-word cuts. An isolated real Arabic speech flow transcribed 116 words, found both previously missed pauses, cut words 34–36 without an inside-word or long-pause warning, placed b-roll/title/captions, produced contact sheets and a real preview MP4, and opened successfully in Chrome. The unavoidable adjacent-word/no-breath listening hint remains visible. QA artifacts are under artifacts/qa/task15; no user project/trash changed or commit made.

## Graphics cache and render speed (Task 16, 2026-11-07)

- «تشويقة» was 7.3 GB, of which 6.9 GB was graphics cache: full-screen HTML graphics were stored as lossless PNG-in-MOV (3.6 GB per 64 s at 1080×1920), and every data tweak left another copy behind.
- Graphic layers are now cached as `.rgba.mkv`: colour in H.264 4:4:4 (CRF 13) and alpha as a separate lossless FFV1 plane. The final pass joins them with `alphamerge`. On the same 64 s graphic: 3.74 GB → 0.69 GB (5.4×), capture plus encode 787 s → 460 s. Composited on a library template: PSNR 58 dB, SSIM 0.9997, alpha practically exact. The cache `VERSION` is bumped, so old PNG entries are never reused.
- Idle frames: when the page has no running animation between two times, the last frame is reused instead of taking a new screenshot (197 of 240 frames on a library template). A long graphic is captured on up to 4 pages in parallel by time range. Render results include per-stage timings and capture stats.
- Cache cleanup after each finished render and at server start, never while a job runs:
  - removes `cache/graphics` and `cache/segments` entries that the project no longer uses and that are older than 24 h;
  - caps each project at 3 GB, oldest unused first (Claude's review: the cap never removes entries the project still uses, which would re-render every export);
  - never follows links and never touches anything outside those two folders.
  - The export dialog shows the cache size with «تنظيف الملفات المؤقتة». A dry run on «تشويقة» would free 7.39 GB, leaving the project at 0.41 GB; nothing was deleted during QA.
- sol hit its usage limit before the report. Claude finished the review, fixed the cap rule, re-ran 303 tests, typecheck and build, and did an isolated end-to-end final export with a library graphic and a lower third (12 s in 24 s; graphic cache 4.4 MB; transparency correct).

## Edit review before export (Task 17, 2026-11-07, built by Claude while sol was at its usage limit)

- `editReview(project, {aspect?})` in `shared/src/edit-review.ts` reads the edit as a viewer would, without rendering. It finds:
  - flash frames under 0.25 s;
  - text gone before it can be read (0.5 s + 3 words/s; captions linked to speech are exempt);
  - two texts in the same place at the same time (estimated boxes);
  - text under the Shorts/Reels buttons or description in 9:16 (one finding per track);
  - black picture, or one note for a mostly sound-only edit;
  - music above 0.8 under speech;
  - more than three same-shot jump cuts within 10 s with no framing change;
  - overlaps on free tracks, open comments and waiting ideas, with their times.
  Each finding has a time, clip ids and a fix hint. Findings never block an export.
- MCP `review {project, aspect?, max?}`: one line per finding. The skill now has a «مراجعة» gate between the cut check and the contact sheet.
- Export dialog: «مراجعة المونتاج (N للإصلاح، M للنظر)». Clicking a finding seeks the timeline and selects its clips. Preflight adds one summary warning when there is something to fix.
- Verified: 9 new tests (a positive and a negative case per check, Arabic reading speed included); 312 tests, typecheck and app build pass. On a copy of night-qa (isolated server and UI), 16:9 shows only the deliberate b-roll overlap. 9:16 groups the 22 captions at y 0.86 into one finding. Clicking selects the overlapping clips, and the RTL layout is checked.

## Rename a media file (2026-11-07, Claude)

- Some imported files show broken names (e.g. «��302 تيك توك�» in «تشويقة», from before the upload encoding fix), and there was no way to change them. `update_media` now takes `patch:{role?, name?}`. A name is trimmed, must not be empty, and changes only the name shown: the file on disk keeps its own. It is undoable.
- Media options dialog (⋯ on a card): «اسم الملف» field with «حفظ». Tests in `media-rename.test.ts`. Checked in the browser on an isolated copy of «تشويقة».

## Faster, stable graphic capture (Task 20, 2026-11-07)

- Built on Claude's `4018b84`. Unused font faces now load before capture: `document.fonts.ready` alone allowed later titles to cache fallback-font widths. Custom graphics also wait for two animation frames before screenshots, removing the last small SVG paint-history difference. A bounded wait falls back to the previous screenshot path; capture stats expose fallback counts. Cache version is 4.
- Custom graphics use x264 `superfast`, CRF 13, two colour threads, with the original `fast` encoder as a failure fallback. Library templates retain their original encoder and capture timing; FFV1 alpha stays lossless. On the same full-size 64 s fixture, total time is 260.0 → 191.5 s (capture 140.9 s, encode 49.5 s). Compared with Task 16's recorded 460.0 s total / 327.6 s capture, that is 2.40× overall / 2.33× capture. The custom cache grows 27.6%; the 6 s chapter fixture takes 14.3 → 15.0 s because of font preparation.
- Verified all 1,920 custom PNGs byte-identical with one versus four workers; all 720 chapter motion-blur subframes and decoded colour/alpha remain exact. Full-length custom quality improves from PSNR 42.96 to 44.27 dB, SSIM 0.97962 to 0.98367; alpha is unchanged. Chrome's alternate capture experiments were measured and excluded. All 320 tests, typecheck and app build pass, plus an isolated real API/editor export. Evidence is in `artifacts/qa/task20/`; temporary projects were removed after archiving. No user project/trash modified or commit made.

## First-user audit fixes (Task 21, 2026-11-07)

- Home creation and file drops preserve the creator's title (including spaces) while keeping a safe, unique folder name. Export review now follows the selected output aspect, so switching a landscape edit to Shorts reveals the corresponding unsafe-area findings. Range render metadata reports the final output duration rather than the full timeline; cached segments retain their original durations.
- Verified 322 tests in 57 files, clean typecheck and successful app build. Isolated real Chrome/UI on 4391/5191 covered all three starts, multi-file import and ordinary analysis, UI editing/undo/redo, notes/marks, styles/brand, Arabic physical-key shortcuts, error states and 9:16. Four actual exports (5/12 seconds landscape, 4/6.5 seconds portrait) were probed and opened. No transcription, paid AI, user-project changes or commit. SOL.md has the findings/proposals table; screenshots, scripts, snapshots and exports are in artifacts/qa/task21/. Temporary projects were removed via validated app routes, and QA servers stopped.

## Broken files explain themselves (Claude, after Task 21)

- Importing a damaged or half-downloaded file showed the raw ffprobe output, with an internal UUID path. The upload card now says in Arabic that the file looks damaged or incomplete and what to try; the raw text is under «تفاصيل تقنية». The finished progress bar is hidden on errors. `app/src/lib/upload-error.ts` + test; checked in the browser on an isolated server.
- `graphic-fonts.test.ts` timed out on the first full run after code changes: its two pages shared one Chrome process and the background one stalled. Each page now has its own process, like the renderer, and Chrome launches outside the test time limit.

## The user's 14-point list (Claude, 2026-11-07)

- Import never places: uploads without a timeline target (panel button, folder import, viewer/app drops) only join the library; a drop on a track places. The first source in the library is still `source`. Library: Ctrl/Shift multi-select, ⋯ / right-click menu, Delete when the library has focus, undoable `remove_media` (asks when the media is on the timeline). Images are images: one-frame GIF/AVIF probe as stills, no seconds badge, kind label, no speed section, full-height on the timeline.
- 4K stills: a ≤1920 px proxy (`image-proxy.ts`, at import and once for older projects); the GL preview uploads a still once, not per frame; timeline tiles are 160 px copies; decoded images of removed media are released. Drag over three 4K stills: no long tasks.
- Timeline: press on empty space moves the playhead at once; ◆ keys drag (one undo), click + Delete, right-click menu (`moveKeysPatch`/`deleteKeysPatch`); per-track height by dragging the line under a track (per project, double-click resets); track lock (`Track.locked`, enforced by ops); drag a head to reorder; a free clip lands on the track where it is dropped even over another (striped, Shift = free layer); main-track magnet toggle: off, V1 clips move in time (`move_main`) and delete leaves a gap (`delete lift`), gaps are `clip.gap` (black, silent, packed like any clip).
- Freedom: place on V1 too (inspector, preview handles, render over black, keyable); wider place/zoom/text limits, typed values beyond the slider track; ◎ shows the zoom focus (draggable) and a layer's anchor. «النوافذ» menu shows/hides every panel (timeline and rail too); the two keyboard buttons moved into Settings; the crop fold no longer closes when a slider passes 0.
- Verified: 332 tests, typecheck, app build; isolated Chrome QA scripts in `artifacts/qa/claude-1107/` (t1–t9) and real exports (V1 place static/keyed; gap black at Y=16 and −91 dB).
- Several audio tracks (an OBS recording: mic, desktop, music): only the first was heard. Import now rewrites the project copy with a first track mixing all of them (`audio-tracks.ts`, labelled `qassa-mix:<tracks>` in title and MP4 handler name), the originals kept after it and the picture copied; analysis follows. The file's ⋯ → options lists the tracks to choose (e.g. only track 1 when it is already a full mix). Analysis, proxy and waveform read `0:a:0` explicitly (ffmpeg's own pick is the most channels).

## A tester's 7 points, and AI tasks that vanished (Claude, 2026-11-07)

- An AI task on a comment disappeared without a word: the dev server reloads on every source change and its job lists lived only in memory. Both job journals are now kept in `logs/` in every mode (git-ignored), so a task cut short shows as failed («أعد تشغيلها»). Project files and the graphics library are served with `Cache-Control: no-cache` (a cheap 304), so pages, proxies and re-mixed recordings rewritten in place are never shown stale (the agent itself reported the stale graphic page).
- ⋯ / «النوافذ» buttons toggle their menu (the press no longer closes and reopens it). Every zoom (wheel, slider, keys) keeps the playhead where it is on screen. Dragging a ◆ leaves the playhead alone. The row-height grip lives only on the edge between track heads, a thin line on hover. Ctrl+Z works while a slider keeps focus (a slider only saves on the keys that move it). Every slider with a default has ↺ (a keyed property loses its keys).
- Anchor point: `Place.ax/ay` (default ½) — size grows about it; everywhere it is the shift (anchor − ½)·(1 − scale) (`anchoredShift`: preview, handles, `placeFilter`, keyed `motion`, main-track place). 3×3 grid, exact sliders, drag on the preview (magnet to centre/edges); moving the anchor never moves the picture (shift compensates, keys too); the size corner scales about it.

## The styles library, rebuilt (Claude, 2026-11-07)

- Six overlapping tabs became three: «طبّق على مشروعك» (looks, filtered by video type, and the editing recipes), «اكتشف أفكار» (the 1,213 references sorted by use in a side list — `shared/src/style-uses.ts` classifies each entry and cleans Awesome's prompt titles; web toys, workflows and entries without a preview hidden unless «أظهر الكل»; clips first, then pictures, films → scenes → prompts) and «مكتبتي» (favourites, recent, saved). The source is a small credit under the title instead of the filter. Space plays from any focused control (buttons, sliders, lists) except text fields and menus; a held key toggles once.


## New-user editing details (Task 22, 2026-11-07)

- All three title actions share one placement helper: consistent styling, an available text layer, duration capped by remaining content (minimum 1 s; 4 s without remaining content), immediate selection and the text field focused with its contents selected. A selected title's entrance is settled only in the paused viewer; playback and export retain the original animation.
- Between-track insert zones are invisible and ignore clicks outside a drag. Snapping is labelled «التصاق» separately from «الأساسي»; audio routing uses a readable «ينخفض تحت الكلام» / «كلام» chip. Timeline and transport tooltips follow the current rebindable shortcuts.
- The empty viewer offers import without repeating the project-start choice. With a library it explains placement and offers «ضع الكل على التايملاين»: videos/images in library order on V1 through the existing placement path, in one undo batch; audio stays in the library.
- Validation: 338 tests in 66 files pass, typecheck clean, app build passes. Real Chrome on isolated 4392/5192 verifies all title entry points, typing, paused versus playing animation, dynamic shortcuts, idle hover/click-through, between-track media drops, the audio chip and one-step batch undo/redo. Nine screenshots and logs are in artifacts/qa/task22/. QA projects/trash are empty and QA servers stopped; user data was untouched. No new ops, MCP changes, commit or installer rebuild.


## Simpler export dialog (Task 23)

- The default export view shows destination presets, file name and range, then a one-line output summary and readiness beside the start button. Format, aspect, resolution, frame rate, quality, codec and conditional caption controls sit in «إعدادات متقدمة». It opens after the viewer's last queued export used custom settings, including across projects; choosing and exporting a preset restores the simple default. Storage failures remain harmless.
- Six video presets form complete rows (three columns on desktop, two on phones); audio has its own compact full-width row. Revision/cache diagnostics are under a separate disclosure. Existing blockers, warnings, review findings, range controls, request payloads and export guards retain their behavior.
- Validation: 338 tests / 66 files pass, typecheck clean, app build passes. Real Chrome at 1366×768 shows the start button without scrolling (even with marked-range fields). Before/after custom MOV exports have identical ffprobe metadata and decoded video hashes: 720×1280, 24 fps, 48 frames, 2 s, AAC stereo 48 kHz. WAV export, preference memory, review seek/select, caption choices, recheck and a 390 px mobile viewport also pass. Evidence and a separately recorded pre-existing single-clip MOV range-render issue are in artifacts/qa/task23/. Temporary projects/trash were removed through validated API routes; no user data, renderer or export contract changed.

## Plain video exports a part again (Claude, after Task 23)

- Found by sol in Task 23: exporting a marked part, H.265 or a small file of a timeline with no text or graphics failed in the final pass (`Output with label '0:v' does not exist`). With no video filters the compiler mapped `[0:v]` as if it were a filter output; it now maps the input stream `0:v`. Compiler test asserts it; real isolated exports (2 s marked 9:16 MOV, H.265, small) all finish.


## Beginner labels and first-run guide (Task 24, 2026-11-08)

- Timeline/export now say «جزء التصدير» with «اسحب المقبضين لتصدير جزء فقط»; fit is «ملاءمة الكل» and keyframes are «حركة» / «نقطة حركة». New projects call V2 «لقطات فوقية»; saved track names stay intact. The inspector has nine named position boxes and a separate full-frame action; position and anchor grids start at the right in RTL.
- The assistant request comes first. With no existing ideas, visual ideas and transcription offers are single-line disclosures with «اعرض»; opening them never starts transcription or AI. Existing idea cards stay expanded.
- The editor's compact «دليل البداية» checks import, placement, an edit and a finished export. «وريني» reveals/highlights each control without executing it. Dismissal and edit milestones are saved per viewer with guarded localStorage; Settings can reopen the guide. Placement/setup do not count as the edit; exports from before the project's creation do not count after reusing a deleted project name.
- Verified 342 tests / 67 files, clean typecheck, successful app build, and a real 1366×768 Chrome walkthrough with an actual 3 s / 1920×1080 / 30 fps MP4. Checked all highlights, dismissal/reload/project switching, Settings replay, storage failure, RTL grid operations and old names/ideas. Evidence is in artifacts/qa/task24/. Isolated projects/trash were purged through validated routes and QA servers stopped; no user data, transcription, paid AI, installer rebuild or commit.


## Laptop workspace (Task 25, 2026-11-08)

- Below 1600 px, a visible «مكتبة المشروع» button opens the library over the workspace. It closes via its heading, backdrop or Escape. Opening it preserves the tools panel; resizing no longer rewrites the saved panel preferences, and a wide window docks the library again. Rail/window-menu state and wide-preview controls follow what is actually visible.
- A visible labelled grip divides viewer and timeline. Drag, arrows and double-click reset work, including maximise/restore. The split is saved as a ratio of the actual workspace, with a balanced 40% timeline default; usable older height preferences migrate, while old CSS-capped oversized defaults fall back to the balanced split. Header, timeline and transport controls wrap instead of overlapping or scrolling off-screen.
- At heights up to 820 px, the start guide becomes a header button with live N/4 progress; clicking opens its checklist. The full guide remains on taller screens. Existing dismissal, Settings replay and «وريني» behavior are retained.
- Real Chrome import → title → export passed at 1280×720, 1366×768 and 1536×864 (DPR 1.25 for the last). Default viewer frame heights improved 182→277, 207→306 and 257→327 CSS px; expanding the timeline exposes all four starter tracks. Three actual 2.5 s / 720p / 30 fps exports and before/after screenshots are in artifacts/qa/task25/. All 345 tests / 68 files pass with two workers; ordinary parallel runs had existing font/upload timeouts (retained in logs). Typecheck and app build pass. QA data was purged and servers stopped; no user data, op/schema, renderer, MCP, installer or commit changes.


## Competitor features, first pass (Claude, night of 2026-11-08)

Sol's Task 25 was reviewed and committed, after which Claude compared Qassa with CapCut, Descript, Gling/TimeBolt and Premiere/Resolve, and built the gaps that need no new downloads or paid AI:

- **Command search** (Ctrl+K, «ابحث عن أمر» in the header): every shortcut action, panels, export/checkpoints/jobs/settings, aspect presets and other projects; Arabic spelling is folded (أ/ا، ة/ه، tashkeel) and English words work; recent commands come first. Shortcut behaviour moved to `lib/actions.ts` so keys and the search share it.
- **Trim to the playhead** (Q / W, also in the clip menu): drop the part of the clip before / after the playhead; the main track ripples, free clips keep their place, locked tracks are skipped.
- **Silence tuning** in the assistant's ready-made cut: «أقصر سكتة تُقص» leaves shorter silences as suggestions, «نَفَس عند الأطراف» keeps a little silence at both edges; saved per viewer; the saving preview and button follow it; still one undo.
- **Preview speed** ×1 / ×1.5 / ×2 (Shift+R, transport button) for reviewing; export unchanged.
- **Word-highlight captions** (`textStyle.highlight`): the spoken word takes the highlight colour in the preview and the export (one still per word, chained like other captions). Inspector «الكلمة المنطوقة» sets it on every caption of the track and for new ones; MCP `captions` takes `style.highlight`. Verified with a real transcript and a 1080p export.
- **Silences sped up instead of cut**: «السكتات: تُقص / تتسرّع ×4» keeps them, faster, with no jump cut (TimeBolt-style).
- Contact sheets (what Claude reviews) draw highlighted captions as the export does.
- **Filler words** («كلمات الحشو» in the text-editing panel): اممم/ممم/um and آآ/uh are picked, «يعني» and «اه/إيه» are offered unpicked; ▶ plays the first; one batch of `cut_words`.
- **Go to time**: click the transport clock and type 83, 1:23, 1:02:03, +5 or Arabic digits.
- Checked: 363 tests / 74 files, typecheck, app build; real Chrome checks on an isolated server (4396/5196, `artifacts/qa/claude-1108/`) for each feature, including undo; a plain 12 s export and a highlighted-caption export probed with ffprobe and inspected frame by frame.
- Not done: face-centred auto-reframe for 9:16 (OpenCV 5 here ships no face model; it needs a downloaded model, the user's call).

## Fixes from making the Qassa explainer video (Claude, 2026-11-15)

Making a 71 s 16:9 explainer of Qassa itself (project `شرح-قصة`: real UI screenshots, callouts, step titles, «داكن كلاسيك») hit four problems; fixed:

- **Renamed repo broke the server and the MCP**: `node_modules/@edit/*` were junctions to the old `Edit-tool` folder, so `@edit/shared` failed to resolve and the edit-tool MCP never connected. Workspace packages now resolve from source: `tsconfig.json` `paths` (tsx for server/MCP, tsc, esbuild for the desktop build), an alias in `packages/app/vite.config.ts` and a root `vitest.config.ts`. Checked with `node_modules/@edit` removed: MCP initialise, server imports, 365 tests, typecheck, app build, esbuild bundle.
- **Auto SFX stuttered**: a step title and its callout 0.7–0.9 s later each got a pop (20 effects in 71 s). `sfxPlan` now drops the same sound within `SAME_SFX_GAP` (1.2 s) and measures the 0.3 s spacing against the last kept cue (it compared with dropped ones). The explainer went to 13 effects. Test in `ops.test.ts`.
- **Black look cards in the styles window** for a podcast (sound on the main track, picture on b-roll): the cards used the main track only. Now, when the main track has no picture at the playhead, they use the composited frame without text layers (contact sheet `texts:false`, new), and nothing is fetched when the project has no picture at all.
- Library templates (`lib/steps`, `lib/chapter`) are sized for an overlay; for a full-screen recap scale them with `place.scale` 1.3–1.35 (no template change).

## 2026-11-15 — timeline stutter, project folders

- **Timeline stuttered while playing** (user: «تايم لاين جالس يكبس»): ~15 panels (media list, inspector sections, comments, transport, cover button) subscribed to `time` and re-rendered on every playback frame, and `EditHandles` forced a layout (`getBoundingClientRect`) every frame even with nothing selected. Panels now use `useSlowTime()` (exact when paused/scrubbing, ≈8 Hz while playing), the media list reads the playhead only on click, `Transport` is memoised, and `EditHandles` measures only a selected text. Profiled on a copy of شرح-قصة (43 clips): React work per frame about halved, forced layouts gone (`artifacts/qa/claude-1115/perf.mjs`).
- **Project folders on the home page** (user: مشروع كبير داخله مشاريع صغيرة، زي مجلد ينحفظ فيه كل شيء عن المشروع): «مجلد جديد», folder cards (covers of its projects, counts) above «مشاريع بلا مجلد», drag a project card onto a folder or «مجلد» on the card. Inside a folder: notes (autosave), shared files (drop/pick, open, download, delete), «مشروع جديد هنا», «أضف مشاريع موجودة», rename/delete (projects stay). A video dropped while a folder is open starts a project inside it. Search shows matching folders and all matching projects with their folder. Claude gets the folder notes and file paths in `project_summary`. Tests: `packages/server/test/folders.test.ts`.

## 2026-11-16 — fixes from making the 9:16 teaser `يارا-تشويقة`

One 82 s full-frame HTML graphic over a voice track, later split into 8 scene pieces on V2. Problems met while making it, fixed:

- **Review said «الصورة سوداء في 100% من المقطع (صوت فقط) → add a graphic»** although a graphic painted every frame. A graphic can now say so: `opaque: true` in its `template.json`; the server passes `opaqueGraphics(dir)` to `editReview`, and such a graphic shown full size counts as picture. Black only behind graphics/text is never «sound only» any more, it stays the per-range info note. Test in `edit-review.test.ts`.
- **A split graphic's content had to be changed piece by piece** (8 `update_clip`s to drop one closing line), and in the editor «المحتوى» changed only the selected piece, so the pieces then disagreed and «المشاهد» stopped treating them as one page. `graphicPieces()` (shared) finds the pieces that play straight on from each other; `update_clip` with `graphicData` sets it on all of them (another use of the same page elsewhere is left alone), and the editor groups scenes with the same rule. Test in `ops.test.ts`.
- **`edit` did not say which clips it created**, so after `split` the new ids had to be read from `project.json`. The ops route returns `added`, and the MCP result lists them (`new clips: id track start–end «label»`).
- **Flaky `brands.test.ts` font test**: ~2 s alone, past its 15 s limit under the full parallel suite (cold browser launch). Now 60 s like `graphic-fonts.test.ts`; full suite 373/373.

## 2026-11-16 — practical editing baseline (Task 26, measurement only)

- Added `docs/research/practical-2026-11.md`: export, timeline, Chrome performance, historical AI/MCP and visible-control measurements; 15 modelled priorities and a separate bug list. Reusable scripts/profiles/screenshots are in `artifacts/qa/task26/`; isolated 4496/5296 with synthetic fixtures and a copy of تشويقة, then deleted.
- Heavy exports measured 119.78 s cold / 102.08 s warm / 33.63 s for a marked 5 s part. Found an animated-text native spawn failure, silent media drop on the playhead, zoomed paused seek leaving the playhead off-screen and a 296 ms startup freeze. Native Explorer checks confirmed both marked files selected before cleanup. No application fixes or paid AI/transcription. Timing reproducibility within ±10% remains unmet, explicitly disclosed; native observation times are controller-inclusive upper bounds.
- Validation: 373 tests / 75 files pass, typecheck and app build pass. No user projects changed and no commit; only research/report documentation changed.

## 2026-11-16 — long export graphs and cached loudness (Task 27, partial)

- Long ffmpeg filtergraphs use relative cache files, including gain substitution; exports skip outside-range text/graphic preparation. Whole-edit loudness is cached with sound/source-sensitive keys, preserving normalization across marked exports. Animated-heavy full/marked renders now succeed; warm 5 s ranges measured 1.68 s static / 1.62 s animated (three-run medians).
- 376 tests, typecheck and app build pass. Strict decoded-frame parity, complete V1 range pruning and cold-full performance acceptance remain open; details and timings are in `docs/research/night-2026-11.md`. Isolated QA only; no user projects or style history changed.

## 2026-11-16 — one-click repeat export (Task 28)

- Header split export uses saved, validated settings; first use opens settings. Progress and a persistent notice show filename/duration, Play/Reveal, warnings and failures. Current marks have their own menu action. Preset suffixes and typed names persist, and outputs remain versioned. Ctrl+E / Ctrl+Shift+E are rebindable and searchable.
- Chrome verified 1 export click + 1 Reveal (no dialog), unchanged ffprobe output, warnings/blockers/stale revision, marked output and remembered names at desktop/laptop sizes. 379 tests/76 files, typecheck and build pass. Evidence and caveats: `docs/research/night-2026-11.md`, `artifacts/qa/task28/`.