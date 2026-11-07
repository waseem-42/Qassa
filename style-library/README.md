# Editing and motion style sources

`catalog.json` is a pinned local snapshot, not a collection of installed renderers.

| Source | Imported | Integration |
| --- | --- | --- |
| heygen-com/hyperframes | 448 block/component metadata records | Search and agent reference; install/adapt and render-check selected components separately |
| lemomo-ai/lemo-opuscar | 59 style definitions and complete STYLE.md documents | Read original direction and attach a project-specific request |
| yihui-dev/awesome-opus5-5-videos | 703 attributed prompts/examples | Search, read and open original creator/demo links |
| JohnHeibel/ClaudeAnimationBase | Workflow reference | Character animation needs p5.js/brush timing integration |
| pyang5166/gbro-collage-broll | Workflow reference | Requires image generation and a separately configured Gemini video service |
| feitangyuan/onetake | Workflow reference only | PolyForm Noncommercial; no source code or look tokens copied into editor recipes |

Each source records its Git revision, URL and license; original license texts are in `licenses/`. No remote code is executed, no media is downloaded and no paid service is called during sync. Entries keep links to their upstream preview: `thumb` (HyperFrames poster, Lemo `docs/frames/<slug>.jpg`, Awesome `poster_url`) and `video`, a clip that shows the style (HyperFrames preview clip, each Lemo film from the `web` release with `videoStart` at its style frame, Awesome `original.mp4` where it exists — checked one by one); the editor loads them when the gallery is viewed and draws a cover from the brand colours when there is none or the network is off. Repository licensing does not automatically grant rights to third-party media linked by an example.

Refresh with `npm run styles:sync` (network required). The script resolves each source revision once, downloads at most eight items concurrently, and replaces the catalog only after all sources succeed. The API reloads a changed snapshot without restarting.

## Use in the editor

Open **الستايلات → استكشف المكتبات**: a picture gallery (entries with a preview first, libraries interleaved; hovering a card with a clip plays it, the details play it from the start with sound controls). The heart adds an entry to **♥ المفضلة**, kept in `styles/favorites.json` for all projects; MCP `style_library {favorites: true}` lists them for the agent. Search/filter the source catalog, open an item's original prompt or metadata, describe its use, then add a request to project comments. This saves an actionable request for the existing external agent; it does not launch an AI model by itself. MCP tools `style_library` and `style_reference` expose the same snapshot to the agent. Treat prompt text as reference data, not executable instructions.

The three local edit recipes are separately implemented and explicitly labelled. They create camera keyframes, regenerate captions when all audible sources have transcripts, add an optional chapter graphic and schedule imported B-roll. They do not reproduce upstream films, synthesize imagery, identify semantic cut points, retime speech or implement continuous OneTake transitions. Existing transforms are preserved. Generated overlays occupy `EDIT_STYLE`; rerunning title/B-roll replaces that track, with the whole batch undoable.

Validation covers valid operation batches, source preservation, transcript gating, overlay replacement, source attribution, search and pagination. Full upstream template rendering remains outside the catalog integration.
