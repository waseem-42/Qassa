import { useLayoutEffect, useRef, useState } from 'react';
import { anchoredShift, clipEnd, MAIN_TRACK, PLACE_LIMITS, placeAt, TextStyle, transformAt, type Clip, type Op, type Project } from '@edit/shared';
import { useStore } from '../lib/store.ts';
import { snapBox } from '../lib/snap.ts';
import { valuesPatch, withZoomKey } from '../lib/anim.ts';
import { useLayout } from '../lib/layout.ts';

// Direct manipulation on the preview: click a text to select it; drag the selected text or
// graphic to move it, its corner to resize it. A graphic whose data has a region (x, y, w, h —
// e.g. lib/callout) gets that region as the handle instead. Drags preview live and save one
// undo step on release, like the inspector sliders.

interface Box { left: number; top: number; width: number; height: number }
type Drag =
  | { kind: 'text-move' | 'text-size'; clip: Clip; x0: number; y0: number; style: TextStyle; box: Box }
  | { kind: 'layer-move' | 'layer-size'; clip: Clip; x0: number; y0: number; place: Place }
  | { kind: 'region-move' | 'region-size'; clip: Clip; x0: number; y0: number; region: Region; layer: Box }
  | { kind: 'focus'; clip: Clip; x0: number; y0: number; focus: { scale: number; x: number; y: number }; span: { x: number; y: number } }
  | { kind: 'anchor'; clip: Clip; x0: number; y0: number; place: Place };
interface Region { x: number; y: number; w: number; h: number }
type Place = ReturnType<typeof placeAt>;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function regionOf(c: Clip): Region | undefined {
  const d = c.graphicData as Record<string, unknown> | undefined;
  return d && ['x', 'y', 'w', 'h'].every((k) => typeof d[k] === 'number') ? { x: d.x as number, y: d.y as number, w: d.w as number, h: d.h as number } : undefined;
}

/**
 * Where the zoom focus shows on the picture, as fractions of the box the picture fills (fill fit), matching
 * framingFilters: the source covers the box times the zoom, cropped around the focus and clamped at its edges.
 * span = how many box widths/heights the zoomed source spans (a pointer move of one box is 1/span of focus).
 */
export function focusOnFrame(m: { width: number; height: number }, boxAspect: number, f: { scale: number; x: number; y: number }) {
  const a = (m.width || 16) / (m.height || 9);
  const span = { x: f.scale * Math.max(1, a / boxAspect), y: f.scale * Math.max(1, boxAspect / a) };
  const at = (s: number, v: number) => s * v - clamp(s * v - 0.5, 0, s - 1);
  return { x: at(span.x, f.x), y: at(span.y, f.y), span };
}

/** Where a layer sits inside the fitted frame (fw × fh px), `pl` = its place at the playhead. */
function layerBox(pl: Place, fw: number, fh: number): Box {
  const width = fw * pl.scale, height = fh * pl.scale, at = anchoredShift(pl);
  return { width, height, left: (fw - width) / 2 + at.x * fw, top: (fh - height) / 2 + at.y * fh };
}

/**
 * The patch that moves the anchor to (ax, ay) without the picture moving (like After Effects): the shift makes up
 * for it at the current size — and every key of a keyed shift moves by as much.
 */
export function anchorPatch(c: Clip, pl: Place, ax: number, ay: number) {
  const k = 1 - pl.scale, ddx = r3((pl.ax - ax) * k), ddy = r3((pl.ay - ay) * k);
  const keyed = (keys: { t: number; v: number }[] | undefined, d: number) => keys?.map((x) => ({ ...x, v: r3(x.v + d) }));
  return {
    place: { ax: r3(ax), ay: r3(ay), ...(c.anim?.dx?.length ? {} : { dx: r3(pl.dx + ddx) }), ...(c.anim?.dy?.length ? {} : { dy: r3(pl.dy + ddy) }) },
    ...(c.anim?.dx?.length || c.anim?.dy?.length ? { anim: { ...(c.anim?.dx?.length ? { dx: keyed(c.anim.dx, ddx) } : {}), ...(c.anim?.dy?.length ? { dy: keyed(c.anim.dy, ddy) } : {}) } } : {}),
  };
}

export function EditHandles({ project, time, fw, fh, frame }: { project: Project; time: number; fw: number; fh: number; frame: React.RefObject<HTMLDivElement> }) {
  const selected = useStore((s) => s.selected);
  const { preview, commit, select } = useStore.getState();
  const [drag, setDrag] = useState<Drag>();
  const [live, setLive] = useState<Region>(); // region while dragging (the page reloads on data changes, so only commit at the end)
  const [textBox, setTextBox] = useState<Box>();
  const [guides, setGuides] = useState<{ gx?: number; gy?: number }>({});
  const magnet = useStore((s) => s.magnet);
  const showFocus = useLayout((s) => s.showFocus);
  const lastOps = useRef<Op[]>();

  const visible = (c: Clip) => !project.tracks.find((t) => t.id === c.trackId)?.hidden && time >= c.start && time < clipEnd(c);
  // a b-roll video/still (picture-in-picture) — or the main track's picture — moves and resizes like a graphic layer
  const isPicture = (c: Clip) => !c.picture?.off && ['overlay', 'video'].includes(project.tracks.find((t) => t.id === c.trackId)?.kind ?? '') && project.media.some((m) => m.id === c.mediaId && m.kind !== 'audio');
  const sel = selected.length === 1 ? project.clips.find((c) => c.id === selected[0] && (c.text || c.graphic || isPicture(c)) && visible(c)) : undefined;

  // measure the selected text box from the layer the viewer rendered
  // (runs after every render — the text moves with previews — so only set state when it changed)
  useLayoutEffect(() => {
    const el = sel?.text ? frame.current?.querySelector(`[data-clip="${sel.id}"] > div`) : null;
    // nothing to measure: don't force a layout on every playback frame
    if (!el) { setTextBox((prev) => prev === undefined ? prev : undefined); return; }
    const f = frame.current?.getBoundingClientRect();
    const r = el && f ? el.getBoundingClientRect() : undefined;
    const next = r && f ? { left: r.left - f.left, top: r.top - f.top, width: r.width, height: r.height } : undefined;
    setTextBox((prev) => (prev && next && (['left', 'top', 'width', 'height'] as const).every((k) => Math.abs(prev[k] - next[k]) < 0.5)) || prev === next ? prev : next);
  });

  const local = (e: React.PointerEvent) => {
    const f = frame.current!.getBoundingClientRect();
    return { x: e.clientX - f.left, y: e.clientY - f.top };
  };
  const show = (ops: Op[]) => { lastOps.current = ops; preview(ops); };
  // a layer's place at the playhead; moving a keyed one sets its keys there
  const at = (c: Clip) => time - c.start;
  const placeOps = (c: Clip, values: Partial<Place>): Op[] => [{ op: 'update_clip', clipId: c.id, patch: valuesPatch(c, values, at(c)) }];

  const begin = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    lastOps.current = undefined;
    setDrag(d);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = local(e);
    let dx = p.x - drag.x0, dy = p.y - drag.y0;
    const c = drag.clip;
    // the magnet: the moved box's edges or centre catch on the frame's edges, centre and thirds (Alt lets go)
    const moved = (b: Box) => {
      if (!magnet || e.altKey) return setGuides({});
      const r = snapBox({ ...b, left: b.left + dx, top: b.top + dy }, fw, fh, 6);
      dx += r.dx; dy += r.dy;
      setGuides({ gx: r.gx, gy: r.gy });
    };
    if (drag.kind === 'text-move') {
      moved(drag.box);
      show([{ op: 'update_clip', clipId: c.id, patch: { textStyle: { x: r3(clamp(drag.style.x + dx / fw, -0.5, 1.5)), y: r3(clamp(drag.style.y + dy / fh, -0.5, 1.5)) } } }]);
    } else if (drag.kind === 'text-size') {
      const k = Math.max(0.2, (drag.box.height + dy) / drag.box.height);
      show([{ op: 'update_clip', clipId: c.id, patch: { textStyle: { size: Math.round(clamp(drag.style.size * k, 6, 1200)) } } }]);
    } else if (drag.kind === 'layer-move') {
      moved(layerBox(drag.place, fw, fh));
      show(placeOps(c, { dx: r3(clamp(drag.place.dx + dx / fw, -PLACE_LIMITS.d, PLACE_LIMITS.d)), dy: r3(clamp(drag.place.dy + dy / fh, -PLACE_LIMITS.d, PLACE_LIMITS.d)) }));
    } else if (drag.kind === 'layer-size') {
      // the corner (bottom-left) follows the pointer away from the anchor, which stays put
      const pl = drag.place, ax = pl.dx * fw + pl.ax * fw, ay = pl.dy * fh + pl.ay * fh;
      let scale = pl.ax > 0.05 ? Math.max(8, Math.abs(ax - p.x)) / (pl.ax * fw) : Math.max(8, Math.abs(p.y - ay)) / Math.max(1, (1 - pl.ay) * fh);
      if (magnet && !e.altKey && Math.abs(scale - 1) * fw < 8) scale = 1; // full frame
      show(placeOps(c, { scale: r3(clamp(scale, PLACE_LIMITS.scaleMin, PLACE_LIMITS.scaleMax)) }));
    } else if (drag.kind === 'anchor') {
      // the anchor goes where it is dropped on the picture; the picture stays where it is
      const L = layerBox(drag.place, fw, fh);
      let ax = clamp((p.x - L.left) / L.width, 0, 1), ay = clamp((p.y - L.top) / L.height, 0, 1);
      // the magnet: the centre, edges and corners of the picture
      if (magnet && !e.altKey) { for (const s of [0, 0.5, 1]) { if (Math.abs(ax - s) * L.width < 8) ax = s; if (Math.abs(ay - s) * L.height < 8) ay = s; } }
      show([{ op: 'update_clip', clipId: c.id, patch: anchorPatch(c, drag.place, ax, ay) }]);
    } else if (drag.kind === 'focus') {
      // unzoomed: the point follows the pointer; zoomed in: the picture does (the view pans). Keyed at the playhead when the zoom has keys.
      const k = drag.focus.scale > 1.001 ? -1 : 1;
      const x = r3(clamp(drag.focus.x + k * dx / fw / drag.span.x, 0, 1)), y = r3(clamp(drag.focus.y + k * dy / fh / drag.span.y, 0, 1));
      const tr = c.transform, local = at(c);
      show([{ op: 'update_clip', clipId: c.id, patch: { transform: tr?.keyframes.length ? { keyframes: withZoomKey(tr.keyframes, { t: local, ...drag.focus, x, y }) } : { x, y } } }]);
    } else if (drag.kind === 'region-move' || drag.kind === 'region-size') {
      const L = drag.layer, R = drag.region;
      if (drag.kind === 'region-move') moved({ left: L.left + R.x * L.width, top: L.top + R.y * L.height, width: R.w * L.width, height: R.h * L.height });
      if (drag.kind === 'region-move') setLive({ ...R, x: r3(clamp(R.x + dx / L.width, 0, 1 - R.w)), y: r3(clamp(R.y + dy / L.height, 0, 1 - R.h)) });
      else setLive({ ...R, w: r3(clamp(R.w + dx / L.width, 0.01, 1 - R.x)), h: r3(clamp(R.h + dy / L.height, 0.01, 1 - R.y)) });
    }
  };

  const onUp = () => {
    const d = drag;
    setDrag(undefined);
    setGuides({});
    if (!d) return;
    if ((d.kind === 'region-move' || d.kind === 'region-size') && live) {
      commit([{ op: 'update_clip', clipId: d.clip.id, patch: { graphicData: { ...(d.clip.graphicData ?? {}), ...live } } }]).finally(() => setLive(undefined));
    } else if (lastOps.current) commit(lastOps.current);
  };

  // click on a text in the frame selects it (and starts moving it)
  const onFrameDown = (e: React.PointerEvent) => {
    const f = frame.current!.getBoundingClientRect();
    const hit = project.clips.filter((c) => c.text && visible(c)).reverse().find((c) => {
      const r = frame.current!.querySelector(`[data-clip="${c.id}"] > div`)?.getBoundingClientRect();
      return r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (!hit) return;
    select([hit.id]);
    const p = { x: e.clientX - f.left, y: e.clientY - f.top };
    begin(e, { kind: 'text-move', clip: hit, x0: p.x, y0: p.y, style: TextStyle.parse(hit.textStyle ?? {}), box: textBox ?? { left: 0, top: 0, width: 1, height: 1 } });
  };

  const corner = (onDown: (e: React.PointerEvent) => void) => (
    <div className="absolute bottom-1 left-1 h-3.5 w-3.5 cursor-nesw-resize rounded-sm border border-ink-950 bg-accent" onPointerDown={onDown} title="اسحب للحجم" />
  );

  let handle: React.ReactNode = null;
  if (sel?.text && textBox) {
    const st = TextStyle.parse(sel.textStyle ?? {});
    handle = (
      <div className="absolute cursor-move border border-dashed border-accent" style={{ left: textBox.left - 4, top: textBox.top - 4, width: textBox.width + 8, height: textBox.height + 8 }}
        onPointerDown={(e) => { const p = local(e); begin(e, { kind: 'text-move', clip: sel, x0: p.x, y0: p.y, style: st, box: textBox }); }}>
        {corner((e) => { const p = local(e); begin(e, { kind: 'text-size', clip: sel, x0: p.x, y0: p.y, style: st, box: textBox }); })}
      </div>
    );
  } else if (sel) {
    const pl = placeAt(sel, at(sel));
    const L = layerBox(pl, fw, fh);
    const region = sel.graphic ? regionOf(sel) : undefined;
    if (region) {
      const R = live ?? region;
      const box = { left: L.left + R.x * L.width, top: L.top + R.y * L.height, width: R.w * L.width, height: R.h * L.height };
      handle = (
        <div className="absolute cursor-move border-2 border-accent bg-accent/10" style={box}
          onPointerDown={(e) => { const p = local(e); begin(e, { kind: 'region-move', clip: sel, x0: p.x, y0: p.y, region, layer: L }); }}>
          <div className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-ink-950 bg-accent"
            onPointerDown={(e) => { const p = local(e); begin(e, { kind: 'region-size', clip: sel, x0: p.x, y0: p.y, region, layer: L }); }} />
        </div>
      );
    } else {
      // only the part inside the frame can be grabbed (a full-frame page's corners sit on its edge)
      const vis = { left: Math.max(0, L.left), top: Math.max(0, L.top), width: 0, height: 0 };
      vis.width = Math.max(24, Math.min(fw, L.left + L.width) - vis.left);
      vis.height = Math.max(24, Math.min(fh, L.top + L.height) - vis.top);
      handle = (
        <div className="absolute cursor-move border border-dashed border-accent" style={vis}
          onPointerDown={(e) => { const p = local(e); begin(e, { kind: 'layer-move', clip: sel, x0: p.x, y0: p.y, place: pl }); }}>
          {corner((e) => { const p = local(e); begin(e, { kind: 'layer-size', clip: sel, x0: p.x, y0: p.y, place: pl }); })}
        </div>
      );
    }
  }

  // ◎ in «زوم وتركيز»: the focus point of the selected picture (drag it to refocus) and a layer's anchor (its centre, what size scales about)
  let focus: React.ReactNode = null;
  const fc = showFocus && selected.length === 1 ? project.clips.find((c) => c.id === selected[0] && visible(c) && !c.picture?.off) : undefined;
  const fm = fc && project.media.find((m) => m.id === fc.mediaId && m.kind !== 'audio');
  const ft = fc && project.tracks.find((t) => t.id === fc.trackId);
  if (fc && fm && ft && (ft.id === MAIN_TRACK || ft.kind === 'overlay')) {
    const box = layerBox(placeAt(fc, at(fc)), fw, fh);
    const now = transformAt(fc.transform, at(fc)), fill = fc.picture?.fit !== 'fit';
    const p = focusOnFrame(fm, box.width / box.height, now);
    focus = <>
      {fill && <div data-focus-point className="focus-point" style={{ left: box.left + p.x * box.width, top: box.top + p.y * box.height }} title={`نقطة التركيز ${Math.round(now.x * 100)}% · ${Math.round(now.y * 100)}% — ${now.scale > 1.001 ? 'اسحب لتحريك الصورة' : 'اسحبها لمكان التركيز'}`}
        onPointerDown={(e) => { const q = local(e); begin(e, { kind: 'focus', clip: fc, x0: q.x, y0: q.y, focus: now, span: p.span }); }} />}
      {(() => { const pl = placeAt(fc, at(fc)), L = layerBox(pl, fw, fh); return <div data-anchor-point className="anchor-point" style={{ left: L.left + pl.ax * L.width, top: L.top + pl.ay * L.height }} title={`نقطة الارتكاز ${Math.round(pl.ax * 100)}% · ${Math.round(pl.ay * 100)}% — الحجم يكبر ويصغر حولها. اسحبها لمكان ثاني (الصورة ما تتحرك)`}
        onPointerDown={(e) => { const q = local(e); begin(e, { kind: 'anchor', clip: fc, x0: q.x, y0: q.y, place: pl }); }} />; })()}
    </>;
  }

  return (
    <div className="absolute inset-0 z-10" onPointerDown={onFrameDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {handle}
      {focus}
      {drag && guides.gx !== undefined && <div className="frame-guide" data-axis="x" style={{ left: guides.gx }} />}
      {drag && guides.gy !== undefined && <div className="frame-guide" data-axis="y" style={{ top: guides.gy }} />}
    </div>
  );
}
