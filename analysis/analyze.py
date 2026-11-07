"""Analyse one media file of a project.

Usage: python analyze.py --project DIR --media-id ID --path REL [--steps probe,proxy,...]
Writes everything into DIR/analysis/<media-id>/ and prints "@@ {json}" progress lines;
the last line is {"result": {...}} with the fields the server merges into the media entry.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

import numpy as np

from common import FFMPEG, emit, h264_args, log, probe, progress, run_ffmpeg, setup_cuda_dlls, write_json

ALL_STEPS = ["probe", "proxy", "peaks", "thumbs", "transcribe", "silence", "shots", "summary"]


# ---------------------------------------------------------------- media prep

def make_proxy(src, out_dir, info):
    if info["kind"] != "video":
        return None
    dst = out_dir / "proxy.mp4"
    # 720p, keyframe every 0.5s and no B-frames so the editor seeks instantly
    fps = info["fps"] or 30
    gop = max(1, round(fps / 2))
    vf = "scale=-2:'min(720,ih)':flags=bicubic,format=yuv420p"
    audio = ["-c:a", "aac", "-b:a", "128k"] if info["hasAudio"] else ["-an"]
    run_ffmpeg(["-i", src, "-vf", vf, *h264_args("proxy"), "-g", gop, "-bf", 0, *audio, "-movflags", "+faststart", dst],
               stage="proxy", duration=info["duration"])
    return dst


def make_peaks(src, out_dir, info, rate=50):
    if not info["hasAudio"]:
        return None
    sr = 8000
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    step = sr // rate
    n = len(pcm) // step
    peaks = np.abs(pcm[: n * step].reshape(n, step)).max(axis=1) if n else np.zeros(0)
    top = float(np.percentile(peaks, 99.5)) if n else 1.0
    peaks = np.clip(peaks / max(top, 1e-4), 0, 1)
    dst = out_dir / "peaks.json"
    write_json(dst, {"rate": rate, "data": [round(float(x), 3) for x in peaks]})
    return dst


def make_thumbs(video, out_dir, info, interval=2.0, w=160, h=90, cols=10, rows=10):
    if info["kind"] != "video":
        return None
    tdir = out_dir / "thumbs"
    tdir.mkdir(exist_ok=True)
    for old in tdir.glob("sheet_*.jpg"):
        old.unlink()
    vf = (f"fps=1/{interval},scale={w}:{h}:force_original_aspect_ratio=decrease,"
          f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,tile={cols}x{rows}")
    run_ffmpeg(["-i", video, "-vf", vf, "-q:v", 5, tdir / "sheet_%03d.jpg"], stage="thumbs", duration=info["duration"])
    sheets = sorted(p.name for p in tdir.glob("sheet_*.jpg"))
    manifest = {"interval": interval, "w": w, "h": h, "cols": cols, "rows": rows,
                "count": int(info["duration"] // interval) + 1, "sheets": [f"thumbs/{s}" for s in sheets]}
    dst = out_dir / "thumbs.json"
    write_json(dst, manifest)
    return dst


# ---------------------------------------------------------------- speech

def transcribe(src, out_dir, info, media_id, model_name, language, prompt):
    if not info["hasAudio"]:
        return None
    setup_cuda_dlls()
    from faster_whisper import WhisperModel

    def load(device, compute):
        progress("transcribe", 0.0, f"loading {model_name} on {device}")
        return WhisperModel(model_name, device=device, compute_type=compute)

    # decode with ffmpeg ourselves: faster-whisper's own PyAV decoding breaks across av versions
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

    def run(model):
        segs, meta = model.transcribe(
            audio, language=language or None, word_timestamps=True, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400}, beam_size=5,
            condition_on_previous_text=False, initial_prompt=prompt or None,
        )
        words, segments = [], []
        for s in segs:
            w0 = len(words)
            for w in s.words or []:
                text = w.word.strip()
                if not text:
                    continue
                words.append({"i": len(words), "t0": round(w.start, 3), "t1": round(w.end, 3), "w": text, "p": round(w.probability, 2)})
            if len(words) > w0:
                segments.append({"t0": round(s.start, 3), "t1": round(s.end, 3), "w0": w0, "w1": len(words) - 1})
            progress("transcribe", s.end / max(info["duration"], 1e-3))
        return words, segments, meta.language

    try:
        words, segments, lang = run(load("cuda", "float16"))
        device = "cuda"
    except Exception as e:  # missing CUDA libraries, out of memory, no GPU
        log(f"cuda transcription failed ({e}); falling back to cpu")
        words, segments, lang = run(load("cpu", "int8"))
        device = "cpu"
    dst = out_dir / "transcript.json"
    write_json(dst, {"mediaId": media_id, "language": lang, "model": f"{model_name}@{device}", "words": words, "segments": segments})
    return dst


_SIL = re.compile(r"silence_(start|end): (-?[\d.]+)")


def detect_silence(src, out_dir, info, noise_db=-35, min_dur=0.35):
    if not info["hasAudio"]:
        return None
    err = run_ffmpeg(["-i", src, "-vn", "-af", f"silencedetect=noise={noise_db}dB:d={min_dur}", "-f", "null", "-"],
                     stage="silence", duration=info["duration"], loglevel="info")
    spans, start = [], None
    for kind, val in _SIL.findall(err):
        t = max(0.0, float(val))
        if kind == "start":
            start = t
        elif start is not None:
            spans.append([round(start, 3), round(t, 3)])
            start = None
    if start is not None:
        spans.append([round(start, 3), info["duration"]])
    dst = out_dir / "silences.json"
    write_json(dst, spans)
    return dst


_DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")


def norm(w):
    w = _DIACRITICS.sub("", w)
    w = re.sub("[إأآا]", "ا", w).replace("ى", "ي").replace("ة", "ه")
    return re.sub(r"[^\w]", "", w.lower())


def refine_words(tr, silences, min_sil=0.5):
    """Whisper often stretches a word across a pause; pull word edges back to the measured silence."""
    long_sil = [(a, b) for a, b in silences if b - a >= min_sil]
    for w in tr["words"]:
        for a, b in long_sil:
            overlap = min(w["t1"], b) - max(w["t0"], a)
            if overlap <= 0.15:
                continue
            if w["t0"] < a:  # word starts before the pause: it ends where the pause begins
                w["t1"] = round(min(w["t1"], a + 0.05), 3)
            else:  # word starts inside the pause: it really starts when the pause ends
                w["t0"] = round(max(w["t0"], b - 0.05), 3)
            if w["t1"] <= w["t0"]:
                w["t1"] = round(w["t0"] + 0.08, 3)
    for s in tr["segments"]:
        s["t0"] = tr["words"][s["w0"]]["t0"]
        s["t1"] = tr["words"][s["w1"]]["t1"]


def suggest_cuts(out_dir, info, media_id, lead=0.12, tail=0.10, min_gap=0.6):
    """Suggest cutting long silences and obvious restarts (retakes)."""
    sil_path = out_dir / "silences.json"
    tr_path = out_dir / "transcript.json"
    silences = json.loads(sil_path.read_text("utf-8")) if sil_path.exists() else []
    tr = json.loads(tr_path.read_text("utf-8")) if tr_path.exists() else None
    words = tr["words"] if tr else []
    if tr and silences:
        refine_words(tr, silences)
        write_json(tr_path, tr)
    # words that still span long stretches are timing artefacts, not speech evidence
    cores = [(w["t0"] + 0.05, w["t1"] - 0.05) for w in words if w["t1"] - w["t0"] < 1.5]
    out = []
    for a, b in silences:
        # keep a breath after speech and before the next word
        t0 = a + (lead if a > 0.05 else 0)
        t1 = b - (tail if b < info["duration"] - 0.05 else 0)
        if t1 - t0 < min_gap:
            continue
        if any(c0 < t1 and c1 > t0 and c1 > c0 for c0, c1 in cores):
            continue  # whisper hears speech here; leave it to a human
        out.append({"mediaId": media_id, "t0": round(t0, 3), "t1": round(t1, 3), "reason": "silence",
                    "note": f"{b - a:.1f}s"})

    # retakes: the same 3+ words said again shortly after -> drop the first attempt
    n = [norm(w["w"]) for w in words]
    i = 0
    while i < len(words) - 3:
        found = False
        for j in range(i + 2, min(len(words) - 2, i + 18)):
            if words[j]["t0"] - words[i]["t0"] > 15:
                break
            k = 0
            while j + k < len(words) and i + k < j and n[i + k] and n[i + k] == n[j + k]:
                k += 1
            if k >= 3:
                text = " ".join(w["w"] for w in words[i:j])
                # cut in the middle of the pauses around the dropped attempt: never inside a word,
                # and the kept speech on both sides keeps some breath
                prev_end = words[i - 1]["t1"] if i else 0.0
                gap0 = max(0.0, words[i]["t0"] - prev_end)
                t0 = prev_end + min(0.12, gap0 * 0.5) if i else max(0.0, words[i]["t0"] - 0.05)
                gap1 = max(0.0, words[j]["t0"] - words[j - 1]["t1"])
                t1 = words[j]["t0"] - min(0.08, gap1 * 0.5)
                out.append({"mediaId": media_id, "t0": round(t0, 3), "t1": round(t1, 3),
                            "reason": "retake", "note": f"أعاد: {text}"})
                i = j
                found = True
                break
        if not found:
            i += 1
    out.sort(key=lambda s: s["t0"])
    write_json(out_dir / "suggestions.json", out)
    return out


# ---------------------------------------------------------------- shots

def detect_shots(video, out_dir, info):
    if info["kind"] != "video":
        return None
    shots = []
    try:
        from scenedetect import AdaptiveDetector, detect
        progress("shots", 0.05, "scene detection")
        scenes = detect(str(video), AdaptiveDetector(), show_progress=False)
        shots = [{"t0": round(a.get_seconds(), 3), "t1": round(b.get_seconds(), 3), "kind": "scene"} for a, b in scenes]
    except Exception as e:
        log(f"scenedetect failed: {e}")
    long_video = info["duration"] > 60
    if len(shots) < 3 and long_video:
        shots = sections_from_transcript(out_dir, info) or shots
    if not shots:
        shots = [{"t0": 0.0, "t1": info["duration"], "kind": "scene"}]
    sdir = out_dir / "shots"
    sdir.mkdir(exist_ok=True)
    for old in sdir.glob("*.jpg"):
        old.unlink()
    import cv2
    for i, s in enumerate(shots):
        s["i"] = i
        t = s["t0"] + min(1.0, (s["t1"] - s["t0"]) / 2)
        thumb = sdir / f"{i:04d}.jpg"
        subprocess.run([FFMPEG, "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1",
                        "-vf", "scale=320:-2", "-q:v", "4", str(thumb)], check=False)
        if thumb.exists():
            s["thumb"] = f"shots/{thumb.name}"
            s["color"] = color_stats(cv2.imread(str(thumb)))
        progress("shots", 0.3 + 0.7 * (i + 1) / len(shots))
    dst = out_dir / "shots.json"
    write_json(dst, shots)
    return dst


def color_stats(img):
    import cv2
    if img is None:
        return None
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    L, A, B = lab[..., 0] * 100 / 255, lab[..., 1] - 128, lab[..., 2] - 128
    return {"L": round(float(L.mean()), 1), "contrast": round(float(L.std()), 1),
            "a": round(float(A.mean()), 1), "b": round(float(B.mean()), 1),
            "chroma": round(float(np.sqrt(A ** 2 + B ** 2).mean()), 1)}


def sections_from_transcript(out_dir, info, min_len=8.0, max_len=45.0, pause=0.9):
    """Screen recordings rarely cut; split them into sections at speech pauses instead."""
    tr = out_dir / "transcript.json"
    if not tr.exists():
        return None
    words = json.loads(tr.read_text("utf-8"))["words"]
    if not words:
        return None
    out, start = [], 0.0
    for a, b in zip(words, words[1:]):
        gap = b["t0"] - a["t1"]
        length = b["t0"] - start
        if (gap >= pause and length >= min_len) or length >= max_len:
            cut = round(a["t1"] + gap / 2, 3)
            out.append({"t0": start, "t1": cut, "kind": "section"})
            start = cut
    out.append({"t0": start, "t1": info["duration"], "kind": "section"})
    return out


# ---------------------------------------------------------------- summary for Claude

def fmt(t):
    m, s = divmod(max(0.0, t), 60)
    return f"{int(m):02d}:{s:04.1f}"


def write_summary(out_dir, info, media_id, name):
    lines = [f"# {name} ({media_id}) — {fmt(info['duration'])} · {info['width']}x{info['height']} · {info['fps']}fps · audio={info['hasAudio']}", ""]
    tr_path = out_dir / "transcript.json"
    sugg_path = out_dir / "suggestions.json"
    sugg = json.loads(sugg_path.read_text("utf-8")) if sugg_path.exists() else []
    if tr_path.exists():
        tr = json.loads(tr_path.read_text("utf-8"))
        words = tr["words"]
        lines += [f"## Transcript ({tr['model']}, {len(words)} words)",
                  "Each line: [source time] #first–#last word index, then the text. Use these indices with cut_words.", ""]
        prev_end = 0.0
        for s in tr["segments"]:
            gap = s["t0"] - prev_end
            if gap >= 0.6:
                lines.append(f"  · {gap:.1f}s pause")
            text = " ".join(w["w"] for w in words[s["w0"]: s["w1"] + 1])
            low = [w["w"] for w in words[s["w0"]: s["w1"] + 1] if w.get("p", 1) < 0.4]
            flag = f"   ⚠ unsure: {' '.join(low)}" if low else ""
            lines.append(f"[{fmt(s['t0'])}–{fmt(s['t1'])}] #{s['w0']}–#{s['w1']} {text}{flag}")
            prev_end = s["t1"]
        lines.append("")
    if sugg:
        lines += [f"## Suggested cuts ({len(sugg)})", ""]
        for s in sugg:
            lines.append(f"- {s['reason']} {fmt(s['t0'])}–{fmt(s['t1'])} {s.get('note', '')}")
        lines.append("")
    shots_path = out_dir / "shots.json"
    if shots_path.exists():
        shots = json.loads(shots_path.read_text("utf-8"))
        lines += [f"## Shots ({len(shots)}, {shots[0]['kind'] if shots else ''})", ""]
        for s in shots:
            c = s.get("color") or {}
            lines.append(f"- shot {s['i']}: {fmt(s['t0'])}–{fmt(s['t1'])}  L={c.get('L')} contrast={c.get('contrast')} chroma={c.get('chroma')}")
    dst = out_dir / "summary.md"
    dst.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return dst


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--media-id", required=True)
    ap.add_argument("--path", required=True)
    ap.add_argument("--name", default=None)
    ap.add_argument("--steps", default=",".join(s for s in ALL_STEPS if s != "transcribe"))
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--language", default="ar")
    ap.add_argument("--prompt", default="")
    a = ap.parse_args()

    project = Path(a.project)
    src = project / a.path
    out_dir = project / "analysis" / a.media_id
    out_dir.mkdir(parents=True, exist_ok=True)
    steps = [s for s in a.steps.split(",") if s]
    rel = lambda p: p.relative_to(project).as_posix() if p else None

    info = probe(src)
    result = {**info, "analyzed": []}
    write_json(out_dir / "probe.json", info)
    result["analyzed"].append("probe")
    proxy = out_dir / "proxy.mp4"
    video_for_analysis = proxy if proxy.exists() else src

    for step in steps:
        progress(step, 0.0)
        if step == "proxy":
            p = make_proxy(src, out_dir, info)
            if p:
                result["proxy"] = rel(p)
                video_for_analysis = p
        elif step == "peaks":
            result["peaks"] = rel(make_peaks(src, out_dir, info))
        elif step == "thumbs":
            result["thumbs"] = rel(make_thumbs(video_for_analysis, out_dir, info))
        elif step == "transcribe":
            transcribe(src, out_dir, info, a.media_id, a.model, a.language, a.prompt)
        elif step == "silence":
            detect_silence(src, out_dir, info)
            result["suggestions"] = suggest_cuts(out_dir, info, a.media_id)
        elif step == "shots":
            detect_shots(video_for_analysis, out_dir, info)
        elif step == "summary":
            write_summary(out_dir, info, a.media_id, a.name or src.name)
        elif step == "probe":
            pass
        else:
            raise SystemExit(f"unknown step {step}")
        result["analyzed"].append(step)
        progress(step, 1.0)

    if proxy.exists():
        result["proxy"] = rel(proxy)
    result = {k: v for k, v in result.items() if v is not None}
    emit(result=result)


if __name__ == "__main__":
    main()
