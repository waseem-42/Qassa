"""Shared helpers for the analysis scripts: progress protocol, ffmpeg calls."""
import json
import os
import re
import shutil
import subprocess
import sys
import threading

FFMPEG = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = os.environ.get("FFPROBE_PATH") or shutil.which("ffprobe") or "ffprobe"

# stdout is the protocol channel to the Node server: one "@@ {json}" per line.
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)


def emit(**kw):
    print("@@ " + json.dumps(kw, ensure_ascii=False), flush=True)


def progress(stage, p, msg=None):
    emit(stage=stage, progress=round(max(0.0, min(1.0, p)), 4), msg=msg)


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def probe(path):
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout
    data = json.loads(out)
    v = next((s for s in data["streams"] if s.get("codec_type") == "video" and s.get("disposition", {}).get("attached_pic") != 1), None)
    a = next((s for s in data["streams"] if s.get("codec_type") == "audio"), None)
    fps = 0.0
    if v and v.get("avg_frame_rate", "0/0") != "0/0":
        n, d = v["avg_frame_rate"].split("/")
        fps = round(float(n) / float(d or 1), 3)
    duration = float(data["format"].get("duration") or (v or a or {}).get("duration") or 0)
    is_image = bool(v) and (duration == 0 or v.get("codec_name") in ("png", "mjpeg", "webp", "bmp")) and not a and fps <= 1
    return {
        "duration": round(duration, 3),
        "width": int(v["width"]) if v else 0,
        "height": int(v["height"]) if v else 0,
        "fps": fps,
        "hasAudio": a is not None,
        "kind": "image" if is_image else ("video" if v else "audio"),
    }


_TIME = re.compile(r"out_time_us=(\d+)")


def run_ffmpeg(args, stage=None, duration=None, loglevel="error"):
    """Run ffmpeg, reporting progress from -progress output. Raises on failure."""
    cmd = [FFMPEG, "-hide_banner", "-loglevel", loglevel, "-y", "-progress", "pipe:1", "-nostats", *map(str, args)]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    # drain stderr on a thread: a full stderr pipe would block ffmpeg while we read stdout
    chunks = []
    reader = threading.Thread(target=lambda: chunks.append(proc.stderr.read()), daemon=True)
    reader.start()
    for line in proc.stdout:
        m = _TIME.match(line.strip())
        if m and stage and duration:
            progress(stage, int(m.group(1)) / 1e6 / duration)
    reader.join()
    err = "".join(chunks)
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg failed: {err.strip()[-800:]}")
    return err


_nvenc = None


def has_nvenc():
    """True when h264_nvenc actually works on this machine (driver + GPU), checked once."""
    global _nvenc
    if _nvenc is None:
        r = subprocess.run(
            [FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1", "-c:v", "h264_nvenc", "-f", "null", "-"],
            capture_output=True,
        )
        _nvenc = r.returncode == 0
    return _nvenc


def h264_args(quality="proxy"):
    cq = {"proxy": 26, "master": 17}[quality]
    if has_nvenc():
        return ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", cq, "-b:v", "0"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", cq - 3]


_cuda_dirs = []


def setup_cuda_dlls():
    """Make pip-installed CUDA libraries (nvidia-cublas-cu12, nvidia-cudnn-cu12) loadable on Windows."""
    import os
    import site
    if os.name != "nt":
        return
    for base in site.getsitepackages():
        root = os.path.join(base, "nvidia")
        if not os.path.isdir(root):
            continue
        for pkg in os.listdir(root):
            b = os.path.join(root, pkg, "bin")
            if os.path.isdir(b):
                _cuda_dirs.append(os.add_dll_directory(b))
                os.environ["PATH"] = b + os.pathsep + os.environ.get("PATH", "")
