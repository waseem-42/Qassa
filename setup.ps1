# Edit-tool setup: checks what is missing and installs only that.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$missing = @()

foreach ($tool in 'node', 'ffmpeg', 'ffprobe', 'python') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { $missing += $tool }
}
if ($missing.Count) {
  Write-Host "Missing: $($missing -join ', ')" -ForegroundColor Red
  Write-Host 'Install with: winget install OpenJS.NodeJS.LTS Gyan.FFmpeg Python.Python.3.12'
  exit 1
}
Write-Host "node $(node -v) | $(ffmpeg -version | Select-Object -First 1)"

if (-not (Test-Path .venv)) {
  Write-Host 'Creating Python venv...'
  python -m venv --system-site-packages .venv
}
$py = '.venv\Scripts\python.exe'
& $py -m pip install -q faster-whisper 'scenedetect[opencv-headless]' opencv-python-headless numpy
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
  Write-Host 'NVIDIA GPU found: installing CUDA libraries for Whisper...'
  & $py -m pip install -q nvidia-cublas-cu12 'nvidia-cudnn-cu12==9.*'
}

if (-not (Test-Path node_modules)) { npm install }

Write-Host ''
Write-Host 'Ready. Start with: npm run dev   (editor: http://localhost:5173)' -ForegroundColor Green
Write-Host 'The first transcription downloads the Whisper large-v3 model (~3 GB).'
