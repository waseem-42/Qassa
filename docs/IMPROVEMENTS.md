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
