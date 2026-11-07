@echo off
setlocal
title Qassa - Video Editor
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto missing_node
where npm >nul 2>&1
if errorlevel 1 goto missing_node

if not exist "node_modules\.bin\concurrently.cmd" (
    echo First-time setup is required. Run setup.ps1, then open this file again.
    pause
    exit /b 1
)

if not defined EDIT_PORT set "EDIT_PORT=4317"
rem AI tasks run `claude -p`: use the Claude Code account kept in .claude-amjad when this machine has one
if not defined CLAUDE_CONFIG_DIR if exist "%USERPROFILE%\.claude-amjad" set "CLAUDE_CONFIG_DIR=%USERPROFILE%\.claude-amjad"
set "QASSA_SERVER_READY="
set "QASSA_APP_READY="
set "QASSA_VITE_OPEN=--open"
if "%QASSA_NO_BROWSER%"=="1" set "QASSA_VITE_OPEN="

echo Checking for an existing Qassa instance...
node --input-type=module -e "async function probe() { try { const r = await fetch('http://127.0.0.1:' + process.env.EDIT_PORT + '/api/health', { signal: AbortSignal.timeout(2000) }); const h = await r.json(); return r.ok && h.ok === true && 'nvenc' in h && 'python' in h ? 0 : 1; } catch { return 1; } } process.exitCode = await probe();"
if not errorlevel 1 set "QASSA_SERVER_READY=1"
node --input-type=module -e "async function probe() { try { const r = await fetch('http://localhost:5173', { signal: AbortSignal.timeout(2000) }); if (!r.ok || !(await r.text()).includes('<title>\u0642\u064e\u0635\u0651\u0629</title>')) return 1; if (process.env.QASSA_SERVER_READY) { const h = await (await fetch('http://localhost:5173/api/health', { signal: AbortSignal.timeout(2000) })).json(); if (h.ok !== true || !('nvenc' in h)) return 1; } return 0; } catch { return 1; } } process.exitCode = await probe();"
if not errorlevel 1 set "QASSA_APP_READY=1"

if defined QASSA_SERVER_READY if defined QASSA_APP_READY goto already_running

echo Starting Qassa.
echo Keep this window open. Press Ctrl+C to stop the editor.
echo.

if defined QASSA_APP_READY (
    echo The editor is already running. Starting only its server...
    call :open_existing_editor
    call npm run server
    goto finished
)

if defined QASSA_SERVER_READY (
    echo The server is already running. Starting only the editor...
    call npm run dev -w @edit/app -- %QASSA_VITE_OPEN%
    goto finished
)

call "node_modules\.bin\concurrently.cmd" -k -n server,app -c blue,magenta "npm run server" "npm run dev -w @edit/app -- %QASSA_VITE_OPEN%"

:finished
if errorlevel 1 (
    echo.
    echo Qassa could not start. Check the error above.
    echo If Qassa is already running, use its existing window or close it first.
    pause
    exit /b 1
)
exit /b 0

:already_running
echo Qassa is already running. Opening the existing editor.
call :open_existing_editor
exit /b 0

:open_existing_editor
if "%QASSA_NO_BROWSER%"=="1" exit /b 0
start "" "http://localhost:5173"
exit /b 0

:missing_node
echo Node.js and npm must be installed to run Qassa.
pause
exit /b 1
