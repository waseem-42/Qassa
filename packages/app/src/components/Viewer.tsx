import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAIN_TRACK, clipDuration, clipEnd, clipsAt, fmtTime, GRAPHIC_RUNTIME, graphicBaseSize, graphicTime, graphicUrl, placeCss, transitionHalf, mainClips, mainDuration, outputSize,
  opacityAt, placeAt, anchoredShift, projectDuration, textLayerHtml, transformAt, volumeAt,
  type Clip, type GraphicEdit, type Media, type Op, type Project, type Theme,
} from '@edit/shared';
import { withEdit } from '../lib/graphic-edit.ts';
import { useStore } from '../lib/store.ts';
import { api, fileUrl, projectPath } from '../lib/api.ts';
import { fadeGain, GradeRenderer, pictureView } from '../lib/glgrade.ts';
import { EditHandles } from './EditHandles.tsx';
import { audioLevel, setDenoise, setGain } from '../lib/audio.ts';
import { Icon, Mark, Spinner } from './Brand.tsx';
import { importFiles } from '../lib/import.ts';
import { StartChoice, startShapeOps } from './StartChoice.tsx';
import { duckGain, trackGain } from '../lib/mix.ts';

/** A main-track piece: a video played by one of the two <video> elements, or a still drawn for its clip's length. */
/** audio: a sound-only clip on the main track (a podcast, a voice-over) — played, with a black picture */
interface Seg { clip: Clip; media: Media; url: string; image?: HTMLImageElement; audio?: boolean }

const stills = new Map<string, HTMLImageElement>();
function still(url: string): HTMLImageElement {
  let img = stills.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    stills.set(url, img);
  }
  return img;
}

function segments(p: Project, name: string): Seg[] {
  const media = new Map(p.media.map((m) => [m.id, m]));
  // forget decoded stills the project no longer uses (a deleted 4K photo kept its memory until a reload)
  const used = new Set(p.media.map((m) => fileUrl(name, m.proxy ?? m.path)));
  for (const url of stills.keys()) if (!used.has(url)) stills.delete(url);
  return mainClips(p).flatMap<Seg>((clip) => {
    const m = media.get(clip.mediaId ?? '');
    const url = m && fileUrl(name, m.proxy ?? m.path);
    if (!m || !url) return [];
    if (m.kind === 'image') return [{ clip, media: m, url, image: still(url) }];
    return m.kind === 'video' || m.kind === 'audio' ? [{ clip, media: m, url, audio: m.kind === 'audio' || !!clip.picture?.off }] : [];
  });
}

const segAt = (segs: Seg[], t: number) => {
  const i = segs.findIndex((s) => t >= s.clip.start - 1e-4 && t < clipEnd(s.clip) - 1e-4);
  return i;
};

function load(el: HTMLVideoElement, seg: Seg, src: number) {
  if (seg.image) return; // stills need no element
  if (el.dataset.url !== seg.url) {
    el.src = seg.url;
    el.dataset.url = seg.url;
  }
  if (Math.abs(el.currentTime - src) > 0.02) el.currentTime = src;
  el.playbackRate = seg.clip.speed;
}

export function Viewer() {
  const project = useStore((s) => s.project)!;
  const name = useStore((s) => s.name)!;
  const playing = useStore((s) => s.playing);
  const time = useStore((s) => s.time);
  const graphicPick = useStore((s) => s.graphicPick);
  const size = outputSize(project.settings);
  const segs = useMemo(() => segments(project, name), [project, name]);

  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const fadeLayer = useRef<HTMLDivElement>(null); // dip / flash transitions
  const canvas = useRef<HTMLCanvasElement>(null);
  const bars = useRef<HTMLCanvasElement>(null); // blurred bars behind a fitted picture
  const vids = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const freeElements = useRef(new Map<string, HTMLMediaElement | HTMLImageElement>());
  const mix = useRef({ gain: 1, at: 0 });
  const freeRefs = useRef(new Map<string, (el: HTMLMediaElement | HTMLImageElement | null) => void>());
  const refFor = (id: string) => {
    if (!freeRefs.current.has(id)) freeRefs.current.set(id, (el) => {
      if (el) freeElements.current.set(id, el);
      else {
        const old = freeElements.current.get(id);
        if (old instanceof HTMLMediaElement) { old.pause(); old.removeAttribute('src'); old.load(); }
        freeElements.current.delete(id);
      }
    });
    return freeRefs.current.get(id)!;
  };
  const renderer = useRef<GradeRenderer>();
  // wall: when the last frame was drawn — a still has no media clock, so playback across it runs on this
  const eng = useRef({ active: 0, seg: -1, lastSet: -1, wall: 0 });
  const segsRef = useRef(segs);
  segsRef.current = segs;
  const projRef = useRef(project);
  projRef.current = project;
  const [fit, setFit] = useState({ w: 640, h: 360 });
  const [safe, setSafe] = useState(false);
  const [glError, setGlError] = useState<string>();

  // fit the output frame into the available space
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const k = Math.min((r.width - 24) / size.width, (r.height - 24) / size.height);
      setFit({ w: Math.max(80, Math.floor(size.width * k)), h: Math.max(45, Math.floor(size.height * k)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.width, size.height]);

  useEffect(() => {
    try {
      renderer.current = new GradeRenderer(canvas.current!);
    } catch (e) {
      setGlError((e as Error).message);
    }
  }, []);

  // seek / prepare the active video whenever time moves from outside the playback loop
  useEffect(() => {
    const e = eng.current;
    if (playing && Math.abs(time - e.lastSet) < 0.08) return;
    const i = segAt(segs, time);
    e.wall = performance.now();
    if (i < 0) { e.seg = -1; vids.forEach((v) => { v.current?.pause(); if (v.current) setGain(v.current, 0); }); return; }
    const s = segs[i];
    const el = vids[e.active].current!;
    e.seg = i;
    load(el, s, s.clip.in + (time - s.clip.start) * s.clip.speed);
    const other = vids[1 - e.active].current!;
    other.pause();
    // inside a transition: hold the neighbour on the idle element so the blend can be drawn while scrubbing
    const prev = segs[i - 1], next = segs[i + 1];
    if (next && clipEnd(s.clip) - time < transitionHalf(s.clip, next.clip)) {
      other.muted = true;
      load(other, next, next.clip.in);
    } else if (prev && time - s.clip.start < transitionHalf(prev.clip, s.clip)) {
      other.muted = true;
      load(other, prev, prev.clip.out - 0.02);
    }
    if (s.image) el.pause();
    else if (playing) el.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, segs]);

  useEffect(() => {
    const e = eng.current;
    const el = vids[e.active].current!;
    if (playing) {
      e.wall = performance.now();
      const i = segAt(segs, useStore.getState().time);
      if (i >= 0) {
        e.seg = i;
        const s = segs[i];
        load(el, s, s.clip.in + (useStore.getState().time - s.clip.start) * s.clip.speed);
        e.wall = performance.now();
        if (!s.image) {
          el.muted = false;
          el.play().catch(() => {});
        }
      }
    } else {
      vids.forEach((v) => v.current?.pause());
      for (const el of freeElements.current.values()) if (el instanceof HTMLMediaElement) el.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // the frame loop: advance playback across cuts, draw graded frames, sync overlay media
  useEffect(() => {
    let raf = 0;
    let lastFrame = 0;
    const loop = () => {
      lastFrame = performance.now();
      tick();
      raf = requestAnimationFrame(loop);
    };
    // background tabs stop animation frames; keep playback crossing cuts anyway
    const watchdog = setInterval(() => performance.now() - lastFrame > 120 && tick(), 40);
    const tick = () => {
      const st = useStore.getState();
      const e = eng.current;
      const segs = segsRef.current;
      const p = projRef.current;
      let el = vids[e.active].current;
      if (!el) return;
      let t = st.time;
      const seg = segs[segAt(segs, t)];
      const now = performance.now();
      if (st.playing) {
        const total = Math.min(projectDuration(p), st.playRange?.[1] ?? Infinity);
        if (!seg || seg.image) t += Math.max(0, (now - e.wall) / 1000);
        else if (el.dataset.url === seg.url && e.seg === segAt(segs, st.time)) {
          t = seg.clip.start + (el.currentTime - seg.clip.in) / seg.clip.speed;
          if (el.ended || el.currentTime >= seg.clip.out - .5 / p.settings.fps) t = clipEnd(seg.clip);
        }
        if (t >= total) {
          t = Math.max(0, total - .001);
          useStore.setState({ playing: false, playRange: undefined });
          vids.forEach((v) => v.current?.pause());
          for (const free of freeElements.current.values()) if (free instanceof HTMLMediaElement) free.pause();
        }
        e.lastSet = t;
        if (Math.abs(t - st.time) > 1e-3) useStore.setState({ time: t });
      }
      e.wall = now;
      const at = segAt(segs, t);
      const current = segs[at];
      if (at !== e.seg || (current && !current.image && el.dataset.url !== current.url)) {
        el.pause(); setGain(el, 0);
        e.seg = at;
        if (current) {
          e.active = 1 - e.active;
          el = vids[e.active].current!;
          load(el, current, current.clip.in + (t - current.clip.start) * current.clip.speed);
          if (useStore.getState().playing && !current.image) { el.muted = false; el.play().catch(() => {}); }
        }
      }

      const upcoming = segs[e.seg + 1];
      if (useStore.getState().playing && current && upcoming && !upcoming.image && clipEnd(current.clip) - t < 1.2 + transitionHalf(current.clip, upcoming.clip)) {
        const other = vids[1 - e.active].current!;
        other.muted = true;
        if (other.dataset.url !== upcoming.url || Math.abs(other.currentTime - upcoming.clip.in) > .05) load(other, upcoming, upcoming.clip.in);
      }

      // draw
      const cur = segs[e.seg];
      const r = renderer.current;
      let fade = 0, fadeColor = 'black';
      if (r && cur) {
        const active = vids[e.active].current!;
        const other = vids[1 - e.active].current!;
        const { width: W, height: H } = outputSize(p.settings);
        const paint = (el: HTMLVideoElement, s: Seg, mix = 1) => {
          if (s.audio) return [0, 0, 1, 1];
          const tr = transformAt(s.clip.transform, s.image ? t - s.clip.start : (el.currentTime - s.clip.in) / s.clip.speed);
          const grade = s.clip.grade ?? p.settings.defaultGrade;
          const pv = pictureView(s.media.width || W, s.media.height || H, W, H, tr, s.clip.picture);
          r.draw(s.image ?? el, grade, grade?.lut ? fileUrl(st.name!, grade.lut) : undefined, pv.view, mix);
          return pv.box;
        };
        if (cur.audio) r.clear();
        const box = paint(active, cur);
        // fit / flip / rotation of the playing clip: the canvas takes the picture's box and turns with it
        const cv = canvas.current, pic = cur.clip.picture;
        // fit on blurred bars: the frame just drawn, covering the whole frame small, blurred by CSS (unturned, like the render)
        const bg = bars.current;
        if (bg && cv) {
          const on = pic?.fit === 'fit' && pic.bars === 'blur';
          if (on) {
            const ctx = bg.getContext('2d');
            const k = (box[2] * W) / (box[3] * H) / (W / H); // picture aspect over frame aspect
            const sw = k > 1 ? cv.width / k : cv.width, sh = k > 1 ? cv.height : cv.height * k;
            ctx?.drawImage(cv, (cv.width - sw) / 2, (cv.height - sh) / 2, sw, sh, 0, 0, bg.width, bg.height);
            const tf = `scale(${pic.flipX ? -1.08 : 1.08}, ${pic.flipY ? -1.08 : 1.08})`;
            if (bg.style.transform !== tf) bg.style.transform = tf;
          }
          const vis = on ? 'visible' : 'hidden';
          if (bg.style.visibility !== vis) bg.style.visibility = vis;
        }
        if (cv) {
          // opacity: the whole frame (bars too) over black, as the render does
          const op = String(Math.round(opacityAt(cur.clip, t - cur.clip.start) * 1000) / 1000);
          // moved / resized on the main track: scaled about the frame centre, then shifted (in frame widths / heights)
          const pl = placeAt(cur.clip, t - cur.clip.start), fr = frame.current;
          const sh = anchoredShift(pl);
          const place = pl.scale !== 1 || pl.dx || pl.dy ? `translate(${sh.x * (fr?.clientWidth ?? 0)}px, ${sh.y * (fr?.clientHeight ?? 0)}px) scale(${pl.scale}) ` : '';
          const css = `${box[0] * 100}%|${box[1] * 100}%|${box[2] * 100}%|${box[3] * 100}%|${place}rotate(${pic?.rotate ?? 0}deg) scale(${pic?.flipX ? -1 : 1}, ${pic?.flipY ? -1 : 1})|${op}|${place}`;
          if (cv.dataset.css !== css) {
            const [l, tp, w, h, tf] = css.split('|');
            // the canvas turns about its own centre; a fitted picture's box is centred, so that is the frame centre too
            Object.assign(cv.style, { left: l, top: tp, width: w, height: h, transform: tf, transformOrigin: `${(0.5 - box[0]) / box[2] * 100}% ${(0.5 - box[1]) / box[3] * 100}%`, opacity: op });
            if (bars.current) { bars.current.style.opacity = op; bars.current.style.translate = place ? `${sh.x * (fr?.clientWidth ?? 0)}px ${sh.y * (fr?.clientHeight ?? 0)}px` : ''; bars.current.style.scale = place ? String(pl.scale) : ''; }
            cv.dataset.css = css;
          }
        }
        // sound: the playing clip at its own volume (silent when the main track is muted); the idle element never sounds
        const mainMuted = p.tracks.find((x) => x.id === MAIN_TRACK)?.muted;
        setGain(active, mainMuted || cur.image ? 0 : volumeAt(cur.clip, t - cur.clip.start) * fadeGain(cur.clip, t));
        setGain(other, 0);
        setDenoise(active, cur.clip.denoise);
        // a transition around this clip's cuts: the idle element holds the neighbour (B preloaded at its in-point,
        // or A paused at its out-point), so it is drawn over with the blend amount. Dip / flash go through a colour.
        // (An approximation: the neighbour is a still frame here; the render plays both.)
        const prev = segs[e.seg - 1], next = segs[e.seg + 1];
        const hIn = prev ? transitionHalf(prev.clip, cur.clip) : 0;
        const hOut = next ? transitionHalf(cur.clip, next.clip) : 0;
        const toCut = clipEnd(cur.clip) - t, fromCut = t - cur.clip.start;
        const side = hOut && toCut < hOut ? { s: next!, kind: next!.clip.transition!.kind, u: 0.5 - toCut / (2 * hOut) }
          : hIn && fromCut < hIn ? { s: prev!, kind: cur.clip.transition!.kind, u: 0.5 + fromCut / (2 * hIn) } : undefined;
        if (side) {
          const toward = side.s === next ? side.u : 1 - side.u; // how much of the neighbour shows (0..0.5)
          if (side.kind === 'dip' || side.kind === 'flash') {
            fade = 1 - Math.abs(2 * side.u - 1);
            fadeColor = side.kind === 'dip' ? 'black' : 'white';
          } else if (side.s.audio) fade = toward;
          else if (side.s.image || other.dataset.url === side.s.url) paint(other, side.s, toward);
        }
      } else {
        r?.clear();
        vids.forEach((v) => { if (v.current) { v.current.pause(); setGain(v.current, 0); } });
        if (bars.current) bars.current.style.visibility = 'hidden';
        if (canvas.current) { Object.assign(canvas.current.style, { left: '0', top: '0', width: '100%', height: '100%', transform: 'none', opacity: '1' }); canvas.current.dataset.css = ''; }
      }
      if (fadeLayer.current) {
        fadeLayer.current.style.opacity = String(fade);
        fadeLayer.current.style.background = fadeColor;
      }

      syncFree(p, st.name!, t, useStore.getState().playing, el);


    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(watchdog);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncFree = (p: Project, nm: string, t: number, isPlaying: boolean, mainEl: HTMLMediaElement) => {
    const voices: HTMLMediaElement[] = [];
    const beds: { el: HTMLMediaElement; c: Clip; track: Project['tracks'][number] }[] = [];
    for (const [id, el] of freeElements.current) {
      const c = p.clips.find((c) => c.id === id), m = p.media.find((m) => m.id === c?.mediaId);
      const track = p.tracks.find((tr) => tr.id === c?.trackId);
      const active = c && m && track && t >= c.start && t < clipEnd(c);
      const visible = active && !track.hidden && !c.picture?.off && track.kind === 'overlay';
      el.style.visibility = visible ? 'visible' : 'hidden';
      if (!active) { if (el instanceof HTMLMediaElement && !el.paused) el.pause(); continue; }
      const url = fileUrl(nm, m.proxy ?? m.path);
      if (url && el.dataset.url !== url) { el.src = url; el.dataset.url = url; }
      if (el instanceof HTMLMediaElement) {
        const want = c.in + (t - c.start) * c.speed;
        if (Math.abs(el.currentTime - want) > (isPlaying ? .1 : .03)) el.currentTime = want;
        el.playbackRate = c.speed;
        const music = track.kind === 'audio' && track.audio !== 'voice' && m.role !== 'sfx';
        setGain(el, m.role === 'sfx' ? track.muted ? 0 : volumeAt(c, t - c.start) * fadeGain(c, t) : track.hidden && track.kind === 'overlay' && !c.picture?.off ? 0 : trackGain(c, track, t, music ? mix.current.gain : 1));
        setDenoise(el, c.denoise);
        if (isPlaying && el.paused) el.play().catch(() => {});
        if (!isPlaying && !el.paused) el.pause();
        if (music) beds.push({ el, c, track });
        else if (m.role !== 'sfx' && (track.kind === 'audio' || c.picture?.off) && !track.muted) voices.push(el);
      }
      if (visible) {
        const pic = c.picture, pl = placeAt(c, t - c.start), crop = pic?.crop;
        el.style.objectFit = pic?.fit === 'fit' ? 'contain' : 'cover';
        el.style.setProperty('object-view-box', crop ? `inset(${crop.t * 100}% ${crop.r * 100}% ${crop.b * 100}% ${crop.l * 100}%)` : 'none');
        const at = anchoredShift(pl);
        el.style.transform = `translate(${at.x * 100}%, ${at.y * 100}%) rotate(${pic?.rotate ?? 0}deg) scale(${pl.scale * (pic?.flipX ? -1 : 1)}, ${pl.scale * (pic?.flipY ? -1 : 1)})`;
        el.style.opacity = String(opacityAt(c, t - c.start));
      }
    }
    const now = performance.now();
    const mainMuted = p.tracks.find((x) => x.id === MAIN_TRACK)?.muted;
    const level = Math.sqrt((mainMuted ? 0 : audioLevel(mainEl) ** 2) + voices.reduce((sum, el) => sum + audioLevel(el) ** 2, 0));
    mix.current.gain = duckGain(level, mix.current.gain, mix.current.at ? Math.min(.1, (now - mix.current.at) / 1000) : 0);
    mix.current.at = now;
    for (const { el, c, track } of beds) setGain(el, trackGain(c, track, t, mix.current.gain));
  };

  // text layers at the playhead, same markup as the renderer
  const shown = (c: Clip) => !project.tracks.find((t) => t.id === c.trackId)?.hidden;
  const texts = project.clips.filter((c) => c.text && shown(c) && time >= c.start && time < clipEnd(c)).sort((a, b) => project.tracks.findIndex((t) => t.id === a.trackId) - project.tracks.findIndex((t) => t.id === b.trackId) || a.start - b.start);
  // graphic pages load a little ahead of the playhead so they are ready when they appear
  const freeMedia = project.tracks.filter((t) => t.kind === 'audio' || t.kind === 'overlay').flatMap((track) => project.clips.filter((c) => c.trackId === track.id && (c.mediaId || c.graphic) && time >= c.start - 2 && time < clipEnd(c) + .5).sort((a, b) => a.start - b.start).map((c) => ({ c, track, m: project.media.find((m) => m.id === c.mediaId) }))).filter(({ m, c, track }) => c.graphic ? !track.hidden : !!m);
  const base = graphicBaseSize(project.settings);
  const k = fit.h / size.height;
  const total = Math.max(mainDuration(project), projectDuration(project));

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-ink-950">
      <div ref={box} className="relative flex min-h-0 flex-1 items-center justify-center" dir="ltr">
        <div ref={frame} className="relative overflow-hidden bg-black shadow-2xl" style={{ width: fit.w, height: fit.h }}>
          <canvas ref={bars} width={96} height={Math.round((96 * size.height) / size.width)} className="viewer-bars" />
          <canvas ref={canvas} width={Math.min(size.width, Math.round(fit.w * devicePixelRatio))} height={Math.min(size.height, Math.round(fit.h * devicePixelRatio))} className="absolute inset-0 h-full w-full" />
          <div ref={fadeLayer} className="pointer-events-none absolute inset-0" style={{ opacity: 0 }} />
          {freeMedia.map(({ c, track, m }) => {
            if (c.graphic) return <GraphicLayer key={c.id} clip={c} project={name} base={base} theme={project.settings.theme} scale={fit.h / base.height} time={time} />;
            const ref = refFor(c.id);
            const audio = track.kind === 'audio' || c.picture?.off || m?.kind === 'audio';
            return audio ? <audio key={c.id} ref={ref} data-free-clip={c.id} preload="metadata" className="hidden" />
              : m?.kind === 'image' ? <img key={c.id} ref={ref} data-free-clip={c.id} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ visibility: 'hidden' }} />
              : <video key={c.id} ref={ref} data-free-clip={c.id} playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" style={{ visibility: 'hidden' }} />;
          })}
          <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: size.width, height: size.height, transform: `scale(${k})` }}>
            {texts.map((c) => {
              const local = time - c.start;
              const dur = clipDuration(c);
              const anim = c.textStyle?.animation ?? 'fade';
              const d = Math.min(0.35, dur / 3);
              const a = anim === 'none' ? 1 : Math.min(1, local / d, (dur - local) / d);
              const dy = anim === 'slide-up' ? Math.max(0, 1 - local / d) * size.height * 0.04 : 0;
              const sc = anim === 'pop' ? 0.92 + 0.08 * Math.min(1, local / d) : 1;
              return (
                <div key={c.id} data-clip={c.id} className="absolute inset-0" style={{ opacity: Math.max(0, a), transform: `translateY(${dy}px) scale(${sc})` }} dangerouslySetInnerHTML={{ __html: textLayerHtml(c, size.height, project.settings.theme) }} />
              );
            })}
          </div>
          {!graphicPick && <EditHandles project={project} time={time} fw={fit.w} fh={fit.h} frame={frame} />}
          {safe && (
            <div className="pointer-events-none absolute border border-dashed border-white/30" style={{ inset: `${fit.h * 0.05}px ${fit.w * 0.05}px` }} />
          )}
          {!project.clips.length && <EmptyViewer />}
          {glError && <div className="absolute bottom-2 left-2 text-xs text-cut">{glError}</div>}
        </div>
        {vids.map((r, i) => (
          <video key={i} ref={r} playsInline preload="auto" className="hidden" muted={i === 1} />
        ))}

      </div>
      <Transport total={total} safe={safe} setSafe={setSafe} />
    </div>
  );
}

/** No clip on the timeline yet: drop a video here (or pick one) to start; while the proxy is made, say so. */
function EmptyViewer() {
  const project = useStore((s) => s.project)!;
  const [shape, setShape] = useState<'video' | 'podcast' | 'empty'>(() => project.tracks.length === 1 ? 'empty' : project.tracks.filter((t) => t.kind === 'overlay').length === 2 ? 'podcast' : 'video');
  const jobs = useStore((s) => s.jobs);
  const [over, setOver] = useState(false);
  const analyzing = Object.values(jobs).find((j) => j.kind === 'analyze' && ['running', 'queued'].includes(j.status) && (j.steps?.includes('proxy') || j.stage === 'proxy') && project.media.some((m) => m.role === 'source' && m.kind === 'video' && (j.mediaId ? j.mediaId === m.id : j.label.endsWith(m.name))));
  return (
    <div className={`absolute inset-3 z-20 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed text-center transition-colors ${over ? 'border-accent bg-accent/10' : 'border-ink-700 hover:border-ink-500'}`} dir="rtl"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); e.stopPropagation(); importFiles([...e.dataTransfer.files]); }}>
      {analyzing ? (
        <>
          <Spinner size={32} />
          <span className="text-ink-300">{`يجهّز المقطع: ${analyzing.stage ?? ''} ${Math.round(analyzing.progress * 100)}%`}</span>
          <span className="text-xs text-ink-500">الملف في مكتبة المشروع؛ اسحبه إلى التايملاين متى ما تبي. التحليل يكمل بالخلفية.</span>
        </>
      ) : (
        <>
          <Mark size={56} />
          <span className="text-lg text-ink-200">أفلت مقطعك هنا</span>
          <label className="btn btn-primary cursor-pointer">أو اختر ملف<input type="file" hidden accept="video/*,audio/*,image/*" multiple onChange={(e) => { importFiles([...(e.target.files ?? [])]); e.target.value = ''; }} /></label>
          {!project.media.length && <div className="flex flex-col items-center gap-2"><span className="text-xs text-ink-500">ابدأ بمسارات تناسبك — كلها قابلة للتغيير</span><StartChoice value={shape} onChange={async (start) => { if (await useStore.getState().ops(startShapeOps(project, start))) setShape(start); }} /></div>}
          <span className="max-w-md text-xs leading-6 text-ink-500">الملفات تنضاف لمكتبة المشروع، وتحطها على التايملاين بسحبها إلى مسار أو بزر ＋. تفريغ الكلام يبدأ فقط لما تطلبه.</span>
        </>
      )}
    </div>
  );
}

type GraphicWindow = Window & {
  eval: (s: string) => void;
  __graphicSeek?: (t: number) => Promise<void>;
  __graphicSetEdits?: (list: GraphicEdit[]) => void;
  __graphicPath?: (el: Element) => string;
};

/** An HTML graphic page in an iframe, paused and seeked to the playhead like the renderer does. */
function GraphicLayer({ clip, project, base, theme, scale, time }: { clip: Clip; project: string; base: { width: number; height: number }; theme: Theme; scale: number; time: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const picking = useStore((s) => s.graphicPick?.clipId === clip.id);
  // hand edits are set live (no reload); everything else in the URL reloads the page
  const url = graphicUrl(project, clip, base, theme, { edits: false });
  const visible = time >= clip.start && time < clipEnd(clip);
  const win = () => frame.current?.contentWindow as GraphicWindow | null;

  useEffect(() => {
    setReady(false);
    setError(undefined);
  }, [url]);

  useEffect(() => {
    if (ready) win()?.__graphicSetEdits?.(clip.graphicEdits ?? []);
  }, [ready, clip.graphicEdits]);

  useEffect(() => {
    const w = win();
    if (ready && w?.__graphicSeek) w.__graphicSeek(graphicTime(clip, time)).catch((e: Error) => setError(e.message));
  }, [ready, time, clip]);

  // picking: hover outlines an element, a click chooses it, a drag moves it
  useEffect(() => {
    const w = win(), doc = frame.current?.contentDocument;
    if (!ready || !picking || !w || !doc) return;
    const box = (css: Partial<CSSStyleDeclaration>) => {
      const d = doc.createElement('div');
      d.dataset.qassaPick = '';
      Object.assign(d.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', boxSizing: 'border-box', display: 'none', borderRadius: '6px', ...css });
      doc.documentElement.appendChild(d);
      return d;
    };
    const hover = box({ border: '3px dashed rgba(242,179,61,.9)' });
    const chosen = box({ border: '4px solid #f2b33d', boxShadow: '0 0 0 4000px rgba(0,0,0,.28)' });
    const put = (b: HTMLDivElement, el: Element | null) => {
      if (!el?.isConnected) { b.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      Object.assign(b.style, { display: 'block', left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    };
    const pickable = (t: EventTarget | null) =>
      t && (t as Node).nodeType === 1 && t !== doc.body && t !== doc.documentElement && !(t as HTMLElement).dataset?.qassaPick ? (t as Element) : null;
    let hovered: Element | null = null;
    let raf = 0;
    const tick = () => {
      const target = useStore.getState().graphicPick?.target;
      let el: Element | null = null;
      try { el = target ? doc.querySelector(target) : null; } catch { /* a stale selector */ }
      put(chosen, el);
      put(hover, hovered === el ? null : hovered);
      raf = requestAnimationFrame(tick);
    };
    tick();
    const { setGraphicPick, preview, commit } = useStore.getState();
    const over = (e: MouseEvent) => { hovered = pickable(e.target); };
    const leave = () => { hovered = null; };
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const el = pickable(e.target);
      if (!el) return setGraphicPick({ clipId: clip.id });
      const target = w.__graphicPath!(el);
      const label = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || el.localName;
      setGraphicPick({ clipId: clip.id, target, label });
      const c = useStore.getState().project?.clips.find((x) => x.id === clip.id);
      const cur = c?.graphicEdits?.find((x) => x.target === target);
      const x0 = e.clientX, y0 = e.clientY, dx0 = cur?.dx ?? 0, dy0 = cur?.dy ?? 0;
      let moved = false;
      const opsAt = (ev: MouseEvent): Op[] => [{
        op: 'update_clip', clipId: clip.id,
        patch: { graphicEdits: withEdit(c?.graphicEdits, target, { label, dx: Math.round(dx0 + ev.clientX - x0), dy: Math.round(dy0 + ev.clientY - y0) }) },
      }];
      const move = (ev: MouseEvent) => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
        moved = true;
        preview(opsAt(ev));
      };
      const up = (ev: MouseEvent) => {
        doc.removeEventListener('mousemove', move);
        doc.removeEventListener('mouseup', up);
        if (moved) commit(opsAt(ev));
      };
      doc.addEventListener('mousemove', move);
      doc.addEventListener('mouseup', up);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setGraphicPick(undefined); };
    doc.addEventListener('mouseover', over);
    doc.addEventListener('mouseleave', leave);
    doc.addEventListener('mousedown', down);
    doc.addEventListener('keydown', key);
    doc.documentElement.style.cursor = 'crosshair';
    return () => {
      cancelAnimationFrame(raf);
      doc.removeEventListener('mouseover', over);
      doc.removeEventListener('mouseleave', leave);
      doc.removeEventListener('mousedown', down);
      doc.removeEventListener('keydown', key);
      doc.documentElement.style.cursor = '';
      hover.remove();
      chosen.remove();
    };
  }, [ready, picking, clip.id]);

  const onLoad = () => {
    const w = win();
    if (!w) return;
    try {
      if (!w.__graphicSeek) w.eval(GRAPHIC_RUNTIME);
      w.addEventListener('error', (e) => setError((e as ErrorEvent).message));
      setReady(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className={`absolute left-0 top-0 origin-top-left ${picking ? 'z-30' : 'pointer-events-none'}`} style={{ width: base.width, height: base.height, transform: `scale(${scale})`, visibility: visible ? 'visible' : 'hidden' }}>
      <div className="h-full w-full" style={{ transform: placeCss(placeAt(clip, time - clip.start), base.width, base.height), transformOrigin: 'center', opacity: opacityAt(clip, time - clip.start) }}>
        <iframe ref={frame} src={url} onLoad={onLoad} title={clip.graphic} data-graphic-clip={clip.id} className="h-full w-full border-0" style={{ background: 'transparent', colorScheme: 'normal' }} />
      </div>
      {error && visible && <div className="absolute bottom-4 left-4 rounded bg-black/80 px-3 py-1 text-2xl text-cut" dir="ltr">{clip.graphic}: {error}</div>}
    </div>
  );
}

function Transport({ total, safe, setSafe }: { total: number; safe: boolean; setSafe: (b: boolean) => void }) {
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const { aspect, resolution, fps } = useStore((s) => s.project!.settings);
  const panels = useStore((s) => s.panels);
  const { seek, setPlaying } = useStore.getState();
  const wide = !panels.tools && !panels.media;
  return (
    <div className="transport" dir="ltr">
      <span className="transport-meta num" title="المقاس · الدقة · الفريمات (من إعدادات المشروع)">{aspect} · {resolution}p · {fps} fps</span>
      <div className="transport-controls">
        <button className="btn btn-ghost" title="البداية (Home)" aria-label="البداية" onClick={() => seek(0)}>{'⏮︎'}</button>
        <button className="btn btn-ghost" title="فريم للخلف (←)" aria-label="فريم للخلف" onClick={() => seek(time - 1 / fps)}>◂</button>
        <button className="play-button" aria-label={playing ? 'إيقاف التشغيل مؤقتًا' : 'تشغيل المعاينة'} title={playing ? 'إيقاف مؤقت (مسافة)' : 'تشغيل (مسافة)'} disabled={!total} onClick={() => setPlaying(!playing)}>{playing ? '❚❚' : '▶'}</button>
        <button className="btn btn-ghost" title="فريم للأمام (→)" aria-label="فريم للأمام" onClick={() => seek(time + 1 / fps)}>▸</button>
        <span className="transport-time num">{fmtTime(time, 2)} <span>/ {fmtTime(total, 2)}</span></span>
      </div>
      <div className="transport-tools">
        <button className={`btn btn-ghost text-xs ${safe ? 'text-accent' : ''}`} aria-label="إظهار حدود الأمان" aria-pressed={safe} onClick={() => setSafe(!safe)} title="حدود الأمان">⬚</button>
        <SaveFrame />
        <SetCover />
        <button className="icon-button" aria-pressed={wide} title={wide ? 'رجّع اللوحات' : 'معاينة واسعة — تخفي اللوحات'} aria-label={wide ? 'رجّع اللوحات' : 'معاينة واسعة'} onClick={toggleWide}><Icon name="expand" size={16} /></button>
      </div>
    </div>
  );
}

/** the panels that were open before the wide preview, to bring back */
let beforeWide: { tools: boolean; media: boolean } = { tools: true, media: true };
function toggleWide() {
  const { panels, showPanel } = useStore.getState();
  if (panels.tools || panels.media) {
    beforeWide = panels;
    showPanel('tools', false);
    showPanel('media', false);
  } else {
    if (beforeWide.media) showPanel('media', true);
    if (beforeWide.tools) showPanel('tools', true);
  }
}

/** The frame at the playhead becomes the project's cover on the home page. */
function SetCover() {
  const time = useStore((s) => s.time);
  const cover = useStore((s) => s.project!.settings.cover);
  const here = cover !== undefined && Math.abs(cover - time) < 0.02;
  const set = async () => {
    const { ops, notify } = useStore.getState();
    if (await ops([{ op: 'set_settings', patch: { cover: Math.round(time * 1000) / 1000 } }])) notify('صارت هذي اللقطة غلاف المشروع في الصفحة الرئيسية', 'info');
  };
  return (
    <button className={`btn btn-ghost text-xs ${here ? 'text-accent' : ''}`} onClick={set} aria-label="اجعلها غلاف المشروع" aria-pressed={here}
      title={here ? 'هذي اللقطة هي غلاف المشروع' : `اجعلها غلاف — صورة المشروع في الصفحة الرئيسية${cover !== undefined ? ` (الحالي عند ${fmtTime(cover, 1)})` : ''}`}>
      <Icon name="image" size={15} />
    </button>
  );
}

/** The frame at the playhead as a full-size JPEG, composited like the export (a thumbnail, a still to post). */
function SaveFrame() {
  const name = useStore((s) => s.name)!;
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const { time, notify } = useStore.getState();
    setBusy(true);
    try {
      const res = await fetch(`${projectPath(name)}/frame?t=${time.toFixed(3)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = `${useStore.getState().project?.name ?? name} ${fmtTime(time, 2).replace(':', '-')}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      notify(`ما قدرت أحفظ الإطار: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn btn-ghost text-xs" disabled={busy} onClick={save} aria-label="حفظ الإطار كصورة" title="حفظ الإطار الحالي كصورة بالمقاس الكامل (مثل التصدير) — للصورة المصغّرة">
      {busy ? <Spinner size={14} /> : <Icon name="camera" size={15} />}
    </button>
  );
}
