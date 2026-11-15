import { outputSize, type Clip, type Place, type Retime, type Settings, type Theme } from './schema.ts';
import { anchoredShift } from './timeline.ts';

// Heavy motion graphics (step lists, comparisons, explainers) are HTML pages: graphics/<name>/ in
// the project, or lib/<template> from the shared graphics-lib/ folder (parametrised by
// clip.graphicData). A page is laid out at the 1080p frame size on a transparent background and
// is driven by time only: CSS animations / Web Animations and GSAP timelines in window.__timelines
// (the HyperFrames convention) are paused and seeked, elements with data-start/data-duration are
// shown in their window, and an optional window.renderFrame(t) draws anything else. The editor
// preview (an iframe) and the renderer (a headless browser, frame by frame) seek the same page with
// the same runtime, so they match.

export const GRAPHICS_LIB_PREFIX = 'lib/';
/** URL prefix the server serves graphics-lib/ under. */
export const GRAPHICS_LIB_URL = '/graphics-lib/';

/**
 * 'graphics/steps' or 'graphics/steps/' -> 'graphics/steps/index.html'; an .html path is kept.
 * Library templates keep their prefix: 'lib/keys' -> 'lib/keys/index.html'.
 */
export function graphicEntry(graphic: string): string {
  const g = graphic.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
  return /\.html?$/i.test(g) ? g : `${g}/index.html`;
}

export const isLibraryGraphic = (graphic: string) => graphicEntry(graphic).startsWith(GRAPHICS_LIB_PREFIX);

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** Server URL path of a graphic page (no query). */
export function graphicUrlPath(project: string, graphic: string): string {
  const entry = graphicEntry(graphic);
  return isLibraryGraphic(graphic)
    ? GRAPHICS_LIB_URL + encPath(entry.slice(GRAPHICS_LIB_PREFIX.length))
    : `/files/${encodeURIComponent(project)}/${encPath(entry)}`;
}

const isDefaultPlace = (pl?: Partial<Place>) => !pl || ((pl.dx ?? 0) === 0 && (pl.dy ?? 0) === 0 && (pl.scale ?? 1) === 1);

/** CSS transform for a graphic layer of a W×H frame (transform-origin: center; the anchor is in the shift). */
export function placeCss(pl: Partial<Place> | undefined, W: number, H: number): string | undefined {
  if (isDefaultPlace(pl)) return undefined;
  const at = anchoredShift(pl!);
  return `translate(${at.x * W}px, ${at.y * H}px) scale(${pl!.scale ?? 1})`;
}

/** The same placement for ffmpeg: a scale filter for the layer and the overlay x/y. Undefined = full frame at 0,0. */
export function placeFilter(pl: Partial<Place> | undefined, W: number, H: number): { scale?: string; x: string; y: string } | undefined {
  if (isDefaultPlace(pl)) return undefined;
  const s = pl!.scale ?? 1, at = anchoredShift(pl!);
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    scale: s !== 1 ? `scale=w=trunc(iw*${s}/2)*2:h=trunc(ih*${s}/2)*2` : undefined,
    x: `(main_w-overlay_w)/2+${r(at.x * W)}`,
    y: `(main_h-overlay_h)/2+${r(at.y * H)}`,
  };
}

/** Piecewise-linear map through matching edges; before/after them time runs at 1:1 from the nearest edge. */
function mapEdges(a: number[], b: number[], s: number): number {
  if (s <= a[0]) return b[0] + (s - a[0]);
  const n = a.length - 1;
  if (s >= a[n]) return b[n] + (s - a[n]);
  let i = 1;
  while (a[i] < s) i++;
  return b[i - 1] + ((s - a[i - 1]) / (a[i] - a[i - 1])) * (b[i] - b[i - 1]);
}

/** Index of the segment [a[i], a[i+1]] holding s, or -1 outside the edges. */
function segment(a: number[], s: number): number {
  if (s < a[0] || s > a[a.length - 1]) return -1;
  let i = 0;
  while (i < a.length - 2 && a[i + 1] <= s) i++;
  return i;
}

/** Page time (as authored) at clip-clock second s of a retimed graphic. With hold, a scene given more
 *  time than authored plays at 1:1 and then stays on its last frame; a shorter one still plays faster. */
export function retimedToPage(r: Retime | undefined, s: number): number {
  if (!r) return s;
  const i = r.hold ? segment(r.to, s) : -1;
  if (i >= 0) {
    const page = r.from[i + 1] - r.from[i], clip = r.to[i + 1] - r.to[i];
    if (clip >= page) return r.from[i] + Math.min(s - r.to[i], page);
  }
  return mapEdges(r.to, r.from, s);
}

/** Clip-clock second at page time s (with hold: where that moment first plays; an edge maps to its edge). */
export function pageToRetimed(r: Retime | undefined, s: number): number {
  if (!r) return s;
  const i = r.hold ? segment(r.from, s) : -1;
  if (i >= 0) {
    const edge = r.from.findIndex((e) => Math.abs(e - s) < 1e-6);
    if (edge >= 0) return r.to[edge];
    const page = r.from[i + 1] - r.from[i], clip = r.to[i + 1] - r.to[i];
    if (clip >= page) return r.to[i] + (s - r.from[i]);
  }
  return mapEdges(r.from, r.to, s);
}

/** Length of the whole page in page seconds (GRAPHIC.duration): its last scene edge, else where the clip ends. */
export function graphicPageDuration(c: Pick<Clip, 'out' | 'retime'>): number {
  return c.retime ? c.retime.from[c.retime.from.length - 1] : c.out;
}

/**
 * The pieces of one graphic split on the timeline: the clip plus every piece of the same page that plays
 * straight on from it (same track, page time and timeline time continue across the cut), in timeline order.
 * Their content (graphicData) is one page, so a change to it goes to all of them.
 */
export function graphicPieces<C extends Pick<Clip, 'id' | 'trackId' | 'graphic' | 'start' | 'in' | 'out' | 'speed' | 'retime'>>(clips: C[], clip: C): C[] {
  if (!clip.graphic) return [clip];
  const same = clips.filter((c) => c.graphic === clip.graphic && c.trackId === clip.trackId && JSON.stringify(c.retime ?? null) === JSON.stringify(clip.retime ?? null));
  const end = (c: C) => c.start + (c.out - c.in) / c.speed;
  const follows = (a: C, b: C) => Math.abs(a.out - b.in) < 1e-3 && Math.abs(end(a) - b.start) < 1e-3;
  const chain = [clip];
  for (let c: C | undefined = clip; (c = same.find((x) => !chain.includes(x) && follows(chain[chain.length - 1], x))); ) chain.push(c);
  for (let c: C | undefined = clip; (c = same.find((x) => !chain.includes(x) && follows(x, chain[0]))); ) chain.unshift(c);
  return chain;
}

/** The page's own time (seconds from its start) at timeline time t. */
export function graphicTime(c: Pick<Clip, 'start' | 'in' | 'out' | 'speed' | 'retime'>, t: number): number {
  return retimedToPage(c.retime, Math.min(c.out, Math.max(c.in, c.in + (t - c.start) * c.speed)));
}

/** Pages are authored at the 1080p version of the project frame (1920x1080, 1080x1920, …). */
export function graphicBaseSize(s: Pick<Settings, 'aspect'>): { width: number; height: number } {
  return outputSize({ aspect: s.aspect, resolution: 1080 });
}

type GraphicRef = Pick<Clip, 'out' | 'graphicData' | 'graphicEdits' | 'retime'>;

/**
 * Query string a host passes to the page: what the page knows about itself at load time.
 * edits: false leaves the hand edits out — the editor sets them live with __graphicSetEdits instead of reloading.
 */
export function graphicQuery(c: GraphicRef, base: { width: number; height: number }, theme?: Theme, { edits = true } = {}): string {
  let q = `duration=${graphicPageDuration(c)}&width=${base.width}&height=${base.height}`;
  if (c.graphicData) q += `&data=${encodeURIComponent(JSON.stringify(c.graphicData))}`;
  if (theme) q += `&theme=${encodeURIComponent(JSON.stringify(theme))}`;
  if (edits && c.graphicEdits?.length) q += `&edits=${encodeURIComponent(JSON.stringify(c.graphicEdits))}`;
  return q;
}

/** Full URL path + query of a graphic clip's page. */
export function graphicUrl(project: string, c: GraphicRef & Pick<Clip, 'graphic'>, base: { width: number; height: number }, theme?: Theme, opts?: { edits?: boolean }): string {
  return `${graphicUrlPath(project, c.graphic!)}?${graphicQuery(c, base, theme, opts)}`;
}

/**
 * Runtime injected into every graphic page (also served at /api/graphics/runtime.js so pages can
 * include it and read window.GRAPHIC while they build). Idempotent.
 */
export const GRAPHIC_RUNTIME = `(() => {
  if (window.__graphicSeek) return;
  const q = new URLSearchParams(location.search);
  const json = (k) => { try { return JSON.parse(q.get(k) || '{}'); } catch (e) { console.error('GRAPHIC.' + k + ' is not JSON', e); return {}; } };
  const g = (window.GRAPHIC = Object.assign({ duration: Number(q.get('duration')) || 0, width: Number(q.get('width')) || 1920, height: Number(q.get('height')) || 1080, time: 0, data: json('data'), theme: json('theme') }, window.GRAPHIC));
  const root = document.documentElement;
  root.style.background = 'transparent';
  // the project theme as CSS variables, so any page can follow it (kit.css uses the same names)
  const vars = { accent: '--accent', accent2: '--accent-2', panel: '--panel', text: '--text', font: '--font' };
  for (const k in vars) if (g.theme[k]) root.style.setProperty(vars[k], k === 'font' ? "'" + g.theme[k] + "'" : g.theme[k]);
  // hand edits (GraphicEdit[]): undone before every seek and laid over the frame after it, so they
  // win over the page's own animations; moves and scales compose with whatever the page animates
  let edits = [];
  try { edits = JSON.parse(q.get('edits') || '[]'); } catch (e) { console.error('edits is not JSON', e); }
  const saved = [];
  const find = (sel) => { try { return document.querySelector(sel); } catch (e) { return null; } };
  const restore = () => {
    for (const s of saved.splice(0).reverse()) {
      if (s.text !== undefined) s.el.textContent = s.text;
      for (const [k, v, pr] of s.style) { if (v) s.el.style.setProperty(k, v, pr); else s.el.style.removeProperty(k); }
    }
  };
  const apply = () => {
    for (const e of edits) {
      const el = e && e.target ? find(e.target) : null;
      if (!el) continue;
      const cs = getComputedStyle(el);
      const tr = cs.translate, sc = cs.scale, fill = cs.fill;
      const s = { el, style: [] };
      saved.push(s);
      const set = (k, v) => { s.style.push([k, el.style.getPropertyValue(k), el.style.getPropertyPriority(k)]); el.style.setProperty(k, v, 'important'); };
      const svg = el instanceof SVGElement;
      if (e.text !== undefined && !el.children.length) { s.text = el.textContent; el.textContent = e.text; }
      if (e.color) set(svg ? (fill === 'none' ? 'stroke' : 'fill') : 'color', e.color);
      if (e.background && !svg) set('background', e.background);
      if (e.hidden) set('visibility', 'hidden');
      if (e.dx || e.dy) {
        const [x = '0px', y = '0px', z] = tr && tr !== 'none' ? tr.split(' ') : [];
        set('translate', 'calc(' + x + ' + ' + (e.dx || 0) + 'px) calc(' + y + ' + ' + (e.dy || 0) + 'px)' + (z ? ' ' + z : ''));
      }
      if (e.scale && e.scale !== 1) {
        const p = sc && sc !== 'none' ? sc.split(' ').map(Number) : [1, 1];
        set('scale', p[0] * e.scale + ' ' + (p.length > 1 ? p[1] : p[0]) * e.scale);
      }
    }
  };
  window.__graphicSetEdits = (list) => { restore(); edits = Array.isArray(list) ? list : []; apply(); };
  /** a selector that finds el again: its data-edit name or id, else its place under the nearest one */
  window.__graphicPath = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== root; n = n.parentElement) {
      if (n.dataset && n.dataset.edit) { parts.unshift('[data-edit="' + CSS.escape(n.dataset.edit) + '"]'); break; }
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      if (n === document.body) { parts.unshift('body'); break; }
      parts.unshift(n.localName + ':nth-child(' + (Array.prototype.indexOf.call(n.parentElement.children, n) + 1) + ')');
    }
    return parts.join(' > ');
  };
  if (!document.querySelector('link[data-graphic-fonts]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = '/api/graphics/fonts.css'; l.dataset.graphicFonts = '';
    (document.head || document.documentElement).appendChild(l);
  }
  const seekMedia = (el, s) => new Promise((done) => {
    el.pause();
    if (Math.abs(el.currentTime - s) < 0.001 || el.readyState < 1) return done();
    const t = setTimeout(done, 3000);
    el.addEventListener('seeked', () => { clearTimeout(t); done(); }, { once: true });
    el.currentTime = s;
  });
  window.__graphicSeek = async (t) => {
    g.time = t;
    restore();
    const waits = [];
    // HyperFrames clips: shown only inside [data-start, data-start + data-duration)
    for (const el of document.querySelectorAll('[data-start]')) {
      if (el.hasAttribute('data-composition-id')) continue;
      const s = Number(el.dataset.start) || 0;
      const d = el.dataset.duration === undefined ? Infinity : Number(el.dataset.duration);
      const on = t >= s && t < s + d;
      el.style.visibility = on ? '' : 'hidden';
      if (on && (el instanceof HTMLMediaElement)) waits.push(seekMedia(el, (t - s) * (Number(el.dataset.playbackRate) || 1) + (Number(el.dataset.mediaStart) || 0)));
    }
    if (typeof window.renderFrame === 'function') await window.renderFrame(t, g);
    for (const tl of Object.values(window.__timelines || {})) {
      if (tl && typeof tl.seek === 'function') { tl.pause && tl.pause(); tl.seek(t, false); }
    }
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
    await Promise.all(waits);
    apply();
  };
  // Only certify idle intervals whose paint is entirely controlled by this runtime. Custom
  // drawing, media, SMIL and GSAP callbacks remain on the screenshot path.
  window.__graphicIdle = (from, to) => {
    if (typeof window.renderFrame === 'function' || Object.keys(window.__timelines || {}).length ||
        document.querySelector('canvas,video,audio,img,iframe,object,embed,svg image,svg animate,svg animateTransform,svg animateMotion,svg set')) return false;
    // A filled transform can re-rasterize at fractional preview scales when its clock is set.
    if (document.getAnimations().length && Math.abs(devicePixelRatio - Math.round(devicePixelRatio)) > 0.000001) return false;
    const lo = Math.min(from, to), hi = Math.max(from, to);
    for (const el of document.querySelectorAll('[data-start]')) {
      const s = Number(el.dataset.start) || 0;
      const e = s + (el.dataset.duration === undefined ? Infinity : Number(el.dataset.duration));
      if ((lo < s && hi >= s) || (lo < e && hi >= e)) return false;
    }
    for (const a of document.getAnimations()) {
      if (!a.effect) return false;
      const timing = a.effect.getComputedTiming();
      const delay = Number(timing.delay), active = Number(timing.activeDuration);
      const rate = a.playbackRate;
      if (rate !== 1 || !Number.isFinite(delay) || Number.isNaN(active)) return false;
      if (hi * 1000 >= delay && lo * 1000 <= delay + active) return false;
    }
    return true;
  };
})();`;
