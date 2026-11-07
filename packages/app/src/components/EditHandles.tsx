import { useLayoutEffect, useRef, useState } from 'react';
import { clipEnd, placeAt, TextStyle, type Clip, type Op, type Project } from '@edit/shared';
import { useStore } from '../lib/store.ts';
import { snapBox } from '../lib/snap.ts';
import { valuesPatch } from '../lib/anim.ts';

// Direct manipulation on the preview: click a text to select it; drag the selected text or
// graphic to move it, its corner to resize it. A graphic whose data has a region (x, y, w, h —
// e.g. lib/callout) gets that region as the handle instead. Drags preview live and save one
// undo step on release, like the inspector sliders.

interface Box { left: number; top: number; width: number; height: number }
type Drag =
  | { kind: 'text-move' | 'text-size'; clip: Clip; x0: number; y0: number; style: TextStyle; box: Box }
  | { kind: 'layer-move' | 'layer-size'; clip: Clip; x0: number; y0: number; place: Place }
  | { kind: 'region-move' | 'region-size'; clip: Clip; x0: number; y0: number; region: Region; layer: Box };
interface Region { x: number; y: number; w: number; h: number }
type Place = ReturnType<typeof placeAt>;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function regionOf(c: Clip): Region | undefined {
  const d = c.graphicData as Record<string, unknown> | undefined;
  return d && ['x', 'y', 'w', 'h'].every((k) => typeof d[k] === 'number') ? { x: d.x as number, y: d.y as number, w: d.w as number, h: d.h as number } : undefined;
}

/** Where a layer sits inside the fitted frame (fw × fh px), `pl` = its place at the playhead. */
function layerBox(pl: Place, fw: number, fh: number): Box {
  const width = fw * pl.scale, height = fh * pl.scale;
  return { width, height, left: (fw - width) / 2 + pl.dx * fw, top: (fh - height) / 2 + pl.dy * fh };
}

export function EditHandles({ project, time, fw, fh, frame }: { project: Project; time: number; fw: number; fh: number; frame: React.RefObject<HTMLDivElement> }) {
  const selected = useStore((s) => s.selected);
  const { preview, commit, select } = useStore.getState();
  const [drag, setDrag] = useState<Drag>();
  const [live, setLive] = useState<Region>(); // region while dragging (the page reloads on data changes, so only commit at the end)
  const [textBox, setTextBox] = useState<Box>();
  const [guides, setGuides] = useState<{ gx?: number; gy?: number }>({});
  const magnet = useStore((s) => s.magnet);
  const lastOps = useRef<Op[]>();

  const visible = (c: Clip) => !project.tracks.find((t) => t.id === c.trackId)?.hidden && time >= c.start && time < clipEnd(c);
  // a b-roll video/still (picture-in-picture) moves and resizes like a graphic layer
  const isPicture = (c: Clip) => !c.picture?.off && project.tracks.find((t) => t.id === c.trackId)?.kind === 'overlay' && project.media.some((m) => m.id === c.mediaId && m.kind !== 'audio');
  const sel = selected.length === 1 ? project.clips.find((c) => c.id === selected[0] && (c.text || c.graphic || isPicture(c)) && visible(c)) : undefined;

  // measure the selected text box from the layer the viewer rendered
  // (runs after every render — the text moves with previews — so only set state when it changed)
  useLayoutEffect(() => {
    const el = sel?.text ? frame.current?.querySelector(`[data-clip="${sel.id}"] > div`) : null;
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
      show([{ op: 'update_clip', clipId: c.id, patch: { textStyle: { x: r3(clamp(drag.style.x + dx / fw, 0, 1)), y: r3(clamp(drag.style.y + dy / fh, 0, 1)) } } }]);
    } else if (drag.kind === 'text-size') {
      const k = Math.max(0.2, (drag.box.height + dy) / drag.box.height);
      show([{ op: 'update_clip', clipId: c.id, patch: { textStyle: { size: Math.round(clamp(drag.style.size * k, 12, 400)) } } }]);
    } else if (drag.kind === 'layer-move') {
      moved(layerBox(drag.place, fw, fh));
      show(placeOps(c, { dx: r3(clamp(drag.place.dx + dx / fw, -1, 1)), dy: r3(clamp(drag.place.dy + dy / fh, -1, 1)) }));
    } else if (drag.kind === 'layer-size') {
      // the corner follows the pointer away from the frame centre
      const half = Math.max(8, Math.abs(p.x - fw / 2 - drag.place.dx * fw));
      let scale = (2 * half) / fw;
      if (magnet && !e.altKey && Math.abs(scale - 1) * fw < 8) scale = 1; // full frame
      show(placeOps(c, { scale: r3(clamp(scale, 0.1, 4)) }));
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

  return (
    <div className="absolute inset-0 z-10" onPointerDown={onFrameDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {handle}
      {drag && guides.gx !== undefined && <div className="frame-guide" data-axis="x" style={{ left: guides.gx }} />}
      {drag && guides.gy !== undefined && <div className="frame-guide" data-axis="y" style={{ top: guides.gy }} />}
    </div>
  );
}
