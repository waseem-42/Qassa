# قَصّة على Windows

Development stays `npm run dev` (server 4317, Vite 5173, data in the repository). `npm run desktop` builds the web UI, plain-JavaScript server and MCP, then opens Electron. `npm run dist:win` creates `artifacts/desktop/Qassa-Setup.exe`, a per-user NSIS installer with Start-menu/desktop shortcuts. Node is provided by Electron; no system Node is used by the installed application. Version is in package.json. There is no auto-update. `npm run dist:portable` creates `artifacts/desktop/Qassa-Portable-<version>.zip` instead: the same unpacked app plus a `portable.txt` marker beside `Qassa.exe`, which makes the data directory `<exe folder>/data` (EDIT_DATA_DIR still wins). Extract anywhere writable and run Qassa.exe; moving the folder keeps the data, and the MCP launcher is rewritten with the new paths on the next start (a previously registered `claude mcp add` must be re-added).

The desktop defaults to the Windows Documents location returned by Electron, under `Qassa`. Set `EDIT_DATA_DIR` to use another location (also useful for isolated QA). Projects, brands, saved styles/favourites/recent history, synthesised SFX, Python/model/package caches, Chromium profile and logs all go there. `EDIT_RESOURCES_DIR` points at read-only packaged resources: graphics library, Python scripts, catalog, fonts and built app. `EDIT_PROJECTS_DIR` remains supported for development/tests. Existing repository projects are never moved automatically.

The parent takes a single-instance lock and starts a server on a free loopback port. It publishes that port atomically as `<data>/.port` only after health verification. A Windows Job Object owns the server and all its descendants: closing or crashing the parent closes the tree. Server crashes are restarted up to three times, shown to the user, with interrupted jobs recovered as failures from the persistent journals. Logs are under `<data>/logs`; individual restarts keep separate server logs.

First-run settings download embeddable Python 3.11.9, pip, the packages from setup.ps1, optional NVIDIA CUDA libraries and a fixed revision of Systran/faster-whisper-large-v3. The screen reports approximate size, phase and transfer bytes, and offers pause/resume/retry. Downloads use local partial files and HTTP Range; pip retains its package cache. Runtime import/model validation must pass before ready.json is written. Until then import/edit/graphics/export work; analysis/transcription explicitly require finishing setup. No Whisper transcription starts simply because setup downloaded the model.

Settings checks for Claude Code and offers the exact `claude mcp add` command to copy. The generated `<data>/qassa-mcp.cmd` uses the installed application's executable as a Node runtime, with the bundled MCP script and explicit data directory. It needs no system Node. For in-editor tasks `<data>/.mcp.json` supplies the same runtime. MCP rereads `.port` on each request, verifies the application's data directory and never auto-starts a second desktop server. The editor works without Claude Code.

Graphics use puppeteer-core and a separate installed Chrome or Edge executable; Electron's Chromium is not driven for graphics rendering. The server searches both standard Edge installation paths and the per-user Edge path.

The uninstaller preserves Documents/Qassa. Unsigned builds have no signing certificate; signing remains a release decision. Existing data migration is also a user decision, and must never silently move repository projects.

## Packaging sources and licences

The build downloads Gyan's static FFmpeg essentials build, checks its published SHA-256, and ships ffmpeg.exe/ffprobe.exe, its LICENSE/README, build configuration, notice and FFmpeg source archive. Gyan describes the builds as GPLv3 and including NVENC: https://www.gyan.dev/ffmpeg/builds/ . FFmpeg's distribution guidance is at https://ffmpeg.org/legal.html . A public release additionally needs the corresponding source/build materials and licence notices for every statically linked external library; the current local test installer is not a published distribution. Do not describe the build as LGPL-only. Electron's own licence notices remain in the installed runtime.

NSIS options: https://www.electron.build/nsis/ . Python embedding details: https://docs.python.org/3.11/using/windows.html#the-embeddable-package .

## Verification

Use a temporary EDIT_DATA_DIR, never the user's projects. Check: app startup with a PATH containing Windows system directories but no Node/Python/ffmpeg; first-run start/pause/resume; import, transcription, a library graphic and an MP4 export; single instance; server crash recovery; closing leaves no server/ffmpeg/python descendants. Also run npm test, typecheck and app build. A fresh Windows profile installer run remains a distinct check from a clean-PATH test on the developer's account; record what was actually exercised in SOL.md.
