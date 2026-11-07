"""Build a style profile from a reference (video or image) and a LUT that moves the sources toward it.

Usage: python style.py --project DIR --ref REL --ref-id ID [--name NAME] [--source REL ...] [--strength 0.7]
Writes refs/<slug>/style.json, refs/<slug>/STYLE.md, refs/<slug>/styleframe.jpg and luts/<slug>.cube.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

import cv2
import numpy as np

from common import FFMPEG, emit, log, probe, progress, write_json


def sample_frames(path, n, width=320):
    """n frames spread over a video (or the image itself), as float32 RGB in 0..1."""
    info = probe(path)
    if info["kind"] == "image":
        img = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if img is None:
            raise SystemExit(f"cannot read image {path}")
        h = int(img.shape[0] * width / img.shape[1])
        return [cv2.cvtColor(cv2.resize(img, (width, h), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB).astype(np.float32) / 255], info
    frames = []
    dur = max(info["duration"], 0.1)
    for i in range(n):
        t = dur * (i + 0.5) / n
        raw = subprocess.run([FFMPEG, "-v", "error", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1",
                              "-vf", f"scale={width}:-2", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
        if not raw:
            continue
        h = len(raw) // (width * 3)
        frames.append(np.frombuffer(raw[: width * h * 3], np.uint8).reshape(h, width, 3).astype(np.float32) / 255)
    return frames, info


def lab_pixels(frames):
    return np.concatenate([cv2.cvtColor(f, cv2.COLOR_RGB2Lab).reshape(-1, 3) for f in frames])


def stats(lab):
    L, a, b = lab[:, 0], lab[:, 1], lab[:, 2]
    chroma = np.sqrt(a ** 2 + b ** 2)
    return {
        "mean": lab.mean(axis=0).round(2).tolist(),
        "std": lab.std(axis=0).round(2).tolist(),
        "L_p5": round(float(np.percentile(L, 5)), 1),
        "L_p95": round(float(np.percentile(L, 95)), 1),
        "chroma": round(float(chroma.mean()), 1),
        "warmth": round(float(b.mean()), 1),
        "tint": round(float(a.mean()), 1),
    }


def palette(lab, k=6):
    pts = lab[np.random.default_rng(0).choice(len(lab), size=min(len(lab), 40000), replace=False)].astype(np.float32)
    _, labels, centers = cv2.kmeans(pts, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.5), 3, cv2.KMEANS_PP_CENTERS)
    share = np.bincount(labels.ravel(), minlength=k) / len(labels)
    out = []
    for i in np.argsort(-share):
        rgb = cv2.cvtColor(centers[i].reshape(1, 1, 3), cv2.COLOR_Lab2RGB).reshape(3)
        rgb = np.clip(rgb * 255, 0, 255).astype(int)
        out.append({"hex": "#%02x%02x%02x" % tuple(rgb), "share": round(float(share[i]), 3)})
    return out


def rhythm(path, info):
    """Cut rhythm of a reference video: our own frame-difference measure, sampled at 8 fps."""
    if info["kind"] != "video" or info["duration"] < 3:
        return None
    w, h = 160, 90
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", str(path), "-vf", f"fps=8,scale={w}:{h},format=gray", "-f", "rawvideo", "-"],
                         capture_output=True).stdout
    frames = np.frombuffer(raw, np.uint8)[: (len(raw) // (w * h)) * w * h].reshape(-1, h, w).astype(np.float32)
    if len(frames) < 3:
        return None
    diff = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
    thresh = max(18.0, float(np.percentile(diff, 97)))
    cuts = [i / 8 for i, d in enumerate(diff, 1) if d > thresh]
    merged = []
    for c in cuts:  # one cut per 0.3s
        if not merged or c - merged[-1] > 0.3:
            merged.append(c)
    bounds = [0.0, *merged, info["duration"]]
    shots = np.diff(bounds)
    still = float((diff < 0.8).mean())
    return {
        "cuts_per_min": round(len(merged) / info["duration"] * 60, 1),
        "avg_shot": round(float(shots.mean()), 2),
        "median_shot": round(float(np.median(shots)), 2),
        "shortest": round(float(shots.min()), 2),
        "longest": round(float(shots.max()), 2),
        "stillness": round(still, 2),
        "energy": round(float(diff.mean()), 2),
    }


def transfer_lut(src_lab, ref_lab, strength, size=33):
    """Reinhard-style mean/std transfer in Lab, softened by strength and clamped so it never goes wild."""
    ms, ss = src_lab.mean(axis=0), src_lab.std(axis=0) + 1e-3
    mr, sr = ref_lab.mean(axis=0), ref_lab.std(axis=0) + 1e-3
    ratio = np.clip(sr / ss, [0.7, 0.6, 0.6], [1.4, 1.6, 1.6])
    # don't drag the overall exposure too far: screen footage and film references differ a lot
    shift = mr - ms
    shift[0] = float(np.clip(shift[0], -12, 12))
    shift[1:] = np.clip(shift[1:], -10, 10)

    g = np.linspace(0, 1, size, dtype=np.float32)
    b, gg, r = np.meshgrid(g, g, g, indexing="ij")  # .cube order: red changes fastest
    rgb = np.stack([r, gg, b], axis=-1).reshape(-1, 1, 3)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2Lab).reshape(-1, 3)
    moved = (lab - ms) * ratio + ms + shift
    lab2 = lab + strength * (moved - lab)
    lab2[:, 0] = np.clip(lab2[:, 0], 0, 100)
    out = cv2.cvtColor(lab2.reshape(-1, 1, 3).astype(np.float32), cv2.COLOR_Lab2RGB).reshape(-1, 3)
    return np.clip(out, 0, 1)


def write_cube(path, table, size, title):
    lines = [f'TITLE "{title}"', f"LUT_3D_SIZE {size}", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"]
    lines += [f"{r:.6f} {g:.6f} {b:.6f}" for r, g, b in table]
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def apply_lut(img, table, size):
    idx = np.clip(np.rint(img * (size - 1)).astype(int), 0, size - 1)
    flat = idx[..., 2] * size * size + idx[..., 1] * size + idx[..., 0]
    return table[flat]


def describe(st):
    L = st["mean"][0]
    light = "داكن" if L < 35 else "متوسط الإضاءة" if L < 60 else "ساطع"
    contrast = "تباين ناعم" if st["std"][0] < 14 else "تباين متوسط" if st["std"][0] < 22 else "تباين قوي"
    sat = "ألوان باهتة" if st["chroma"] < 10 else "ألوان معتدلة" if st["chroma"] < 22 else "ألوان مشبعة"
    temp = "دافئ" if st["warmth"] > 6 else "بارد" if st["warmth"] < -4 else "محايد"
    return f"{light}، {contrast}، {sat}، طابع {temp}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--ref", required=True)
    ap.add_argument("--ref-id", required=True)
    ap.add_argument("--name", default=None)
    ap.add_argument("--source", action="append", default=[])
    ap.add_argument("--strength", type=float, default=0.7)
    a = ap.parse_args()

    project = Path(a.project)
    ref_path = project / a.ref if not Path(a.ref).is_absolute() else Path(a.ref)
    name = a.name or ref_path.stem
    slug = re.sub(r"[^\w-]+", "-", name, flags=re.UNICODE).strip("-").lower() or a.ref_id
    out_dir = project / "refs" / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    (project / "luts").mkdir(exist_ok=True)

    progress("style", 0.05, "sampling reference")
    ref_frames, ref_info = sample_frames(ref_path, 24)
    ref_lab = lab_pixels(ref_frames)
    ref_stats = stats(ref_lab)
    progress("style", 0.3, "palette")
    pal = palette(ref_lab)
    progress("style", 0.45, "rhythm")
    rh = rhythm(ref_path, ref_info)

    src_frames = []
    for s in a.source:
        sp = project / s if not Path(s).is_absolute() else Path(s)
        f, _ = sample_frames(sp, max(6, 24 // max(1, len(a.source))))
        src_frames += f
    progress("style", 0.65, "building LUT")
    lut_rel = None
    src_stats = None
    size = 33
    if src_frames:
        src_lab = lab_pixels(src_frames)
        src_stats = stats(src_lab)
        table = transfer_lut(src_lab, ref_lab, a.strength, size)
        lut_rel = f"luts/{slug}.cube"
        write_cube(project / lut_rel, table, size, f"match {name}")
        # styleframe: source | graded | reference
        h = 180
        def fit(img):
            w = int(img.shape[1] * h / img.shape[0])
            return cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
        sf = src_frames[len(src_frames) // 2]
        row = [fit(sf), fit(apply_lut(sf, table, size).reshape(sf.shape)), fit(ref_frames[len(ref_frames) // 2])]
        strip = np.concatenate([np.pad(x, ((4, 4), (4, 4), (0, 0)), constant_values=0.1) for x in row], axis=1)
        cv2.imwrite(str(out_dir / "styleframe.jpg"), cv2.cvtColor((strip * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))

    style = {
        "name": name, "refId": a.ref_id, "ref": a.ref, "strength": a.strength,
        "look": describe(ref_stats), "color": ref_stats, "palette": pal, "rhythm": rh,
        "source": src_stats, "lut": lut_rel, "styleframe": f"refs/{slug}/styleframe.jpg" if src_frames else None,
    }
    write_json(out_dir / "style.json", style)

    pal_md = " ".join(f"`{p['hex']}` {round(p['share'] * 100)}%" for p in pal)
    rh_md = (f"{rh['cuts_per_min']} قطع/دقيقة · متوسط اللقطة {rh['avg_shot']}ث (الوسيط {rh['median_shot']}ث، أقصر {rh['shortest']}ث، أطول {rh['longest']}ث) · سكون {round(rh['stillness'] * 100)}%"
             if rh else "مرجع ثابت (صورة) — لا إيقاع")
    md = f"""# STYLE — {name}

> مُولّد من الرفرنس `{a.ref}`. الأرقام مقيسة؛ الأقسام المعلّمة بـ ✎ يكملها Claude بعد ما يشوف `styleframe.jpg`.

## Essence
{describe(ref_stats)}. ✎ جملة واحدة: وش اللي يخلي هذا الستايل يشتغل؟

## Colour
- الباليت: {pal_md}
- الإضاءة L={ref_stats['mean'][0]} (p5 {ref_stats['L_p5']} → p95 {ref_stats['L_p95']}) · التباين {ref_stats['std'][0]}
- التشبع (chroma) {ref_stats['chroma']} · الحرارة b={ref_stats['warmth']} · التنت a={ref_stats['tint']}
- LUT: `{lut_rel or '—'}` بقوة {a.strength} (عدّلها من lutMix)

## Rhythm
{rh_md}

## Type
✎ الخط والوزن والحجم وأماكن النصوص كما تظهر في الرفرنس.

## Motion
✎ زوم؟ حركة كاميرا؟ انتقالات؟

## Pitfalls
✎ وش اللي يكسر الستايل لو بالغنا فيه؟
"""
    (out_dir / "STYLE.md").write_text(md, encoding="utf-8")
    progress("style", 1.0)
    emit(result={"style": f"refs/{slug}/style.json", "styleMd": f"refs/{slug}/STYLE.md", "lut": lut_rel,
                 "styleframe": style["styleframe"], "look": style["look"], "rhythm": rh})


if __name__ == "__main__":
    main()
