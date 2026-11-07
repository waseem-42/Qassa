import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IDEA_KINDS, MAIN_TRACK, volumeAt, clipDuration, clipEnd, fmtTime, ideaSpan, mainClips, projectDuration, sourceToTimeline, trackClips, transitionHalf, timelineToSource,
  applyOps, clipFitsTrack, freeMoveOps, mainInsertion, mediaFitsTrack, mediaPlacementOps, trackOverlaps, makeId, type Clip, type MediaTarget, type Op, type Project, type Track,
} from '@edit/shared';
import { useStore, type Analysis } from '../lib/store.ts';
import { fileUrl } from '../lib/api.ts';
import { actionFor, comboOf, useKeys } from '../lib/keys.ts';
import { rowHeight, useTimelineView } from '../lib/timeline-view.ts';
import { snapSpan, snapTime, timelineTargets } from '../lib/snap.ts';
import { keyTimes } from '../lib/anim.ts';
import { Icon } from './Brand.tsx';
import { ClipMenu } from './ClipMenu.tsx';
import { GraphicPicker, sceneEdges, useScenes } from './GraphicControls.tsx';
import { draggingMediaId, importFiles, isFileDrag, MEDIA_DRAG, placeMedia, setDraggingMedia } from '../lib/import.ts';
import { Modal } from './Modal.tsx';
import { bandHits, bandSelection } from '../lib/selection.ts';
type IconName = Parameters<typeof Icon>[0]['name'];

const HEAD = 150;
const MARKS = 22;
const RULER = MARKS + 26;
const NOTES_LANE = 30;
const COLOR: Record<Track['kind'], string> = { video: 'var(--color-clip-video)', overlay: 'var(--color-clip-overlay)', text: 'var(--color-clip-text)', audio: 'var(--color-clip-audio)' };
const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

type Drag =
  | { kind: 'trim'; clip: Clip; edge: 'in' | 'out'; x0: number; scroll0: number; value: number }
  /** over: another track the clip would land on (dropped there: it moves to that track) */
  | { kind: 'move'; clip: Clip; group: Clip[]; fixedTracks?: boolean; x0: number; scroll0: number; start: number; dx: number; over?: string; plan?: Op[]; index?: number }
  | { kind: 'scrub'; offset: number; targets: number[] }
  | { kind: 'mark'; edge: 'in' | 'out'; value: number; offset: number; base: Project['settings']['marks']; targets: number[] }
  | { kind: 'band'; x0: number; y0: number; x: number; y: number; from: number; to: number; moved: boolean; mode: 'replace' | 'add' | 'toggle'; base: string[] };

/** The preview follows the same track compatibility as persisted move ops. */
function fitsTrack(c: Clip, t: Track, p: Project): boolean {
  return clipFitsTrack(p, c, t);
}

type Landing = { trackId?: string; at: number; duration: number; request: MediaTarget; plan: Op[]; mediaId?: string; label: string; error?: string; x: number; y: number };

/** Clips whose in-point is their own clock (text, HTML graphics), not a position in a media file. */
const isLayer = (c: Clip) => c.trackId !== MAIN_TRACK && !c.mediaId && (!!c.text || !!c.graphic);

const images = new Map<string, HTMLImageElement>();
function sprite(url: string, onload: () => void) {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  if (!img.complete) img.addEventListener('load', onload, { once: true });
  return img;
}

export function Timeline() {
  const project = useStore((s) => s.project)!;
  const name = useStore((s) => s.name)!;
  const zoom = useStore((s) => s.zoom);
  const largeWave = useStore((s) => s.largeWave);
  const selected = useStore((s) => s.selected);
  const analysis = useStore((s) => s.analysis);
  const { seek, select, ops, setZoom } = useStore.getState();
  const scroller = useRef<HTMLDivElement>(null);
  const outer = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 1200 });
  const [drag, setDragState] = useState<Drag>();
  const dragRef = useRef<Drag>();
  // Pointer-up can arrive before React paints the last move; commit that final position.
  const setDrag = (next: Drag | undefined) => { dragRef.current = next; setDragState(next); };
  const [dropIndex, setDropIndex] = useState<number>();
  const [landing, setLandingState] = useState<Landing>();
  const landingRef = useRef<Landing>();
  const setLanding = (next?: Landing) => { landingRef.current = next; setLandingState(next); };
  const size = useTimelineView((s) => s.size), maximised = useTimelineView((s) => s.maximised);
  const mixedHint = useRef(false);
  const placementIds = useRef(new Map<string, string>());
  const stablePlan = (plan: Op[]): Op[] => {
    const ids = new Map<string, string>();
    plan.forEach((op, i) => {
      if (op.op !== 'add_track') return;
      const key = `${i}:${op.track.kind}`, id = placementIds.current.get(key) ?? op.track.id;
      placementIds.current.set(key, id); ids.set(op.track.id, id);
    });
    return plan.map((op) => op.op === 'add_track' ? { ...op, track: { ...op.track, id: ids.get(op.track.id)! } } : op.op === 'move_track' || op.op === 'move' ? { ...op, trackId: ids.get(op.trackId!) ?? op.trackId } : op.op === 'add_clip' ? { ...op, clip: { ...op.clip, trackId: ids.get(op.clip.trackId) ?? op.clip.trackId } } : op) as Op[];
  };
  const pointer = useRef<{ clientX: number; clientY: number; altKey: boolean; media?: boolean }>();
  const moveRef = useRef<(e: { clientX: number; clientY: number; altKey: boolean }) => void>();
  const mediaRef = useRef<(e: { clientX: number; clientY: number; altKey: boolean }) => void>();
  // the first click re-renders the clip (selection), so the browser never sees a dblclick: detect it here
  const lastDown = useRef({ id: '', at: 0 });
  const [menu, setMenu] = useState<{ clip: Clip; x: number; y: number }>();
  const closeMenu = useCallback(() => setMenu(undefined), []);

  const duration = Math.max(projectDuration(project), 5);
  const contentW = Math.max(duration, project.settings.marks.in ?? 0, project.settings.marks.out ?? 0) * zoom + 400;
  const previewOps = landing?.plan ?? (drag?.kind === 'move' ? drag.plan : undefined);
  const tracks = previewOps?.length ? applyOps(project, previewOps).tracks : project.tracks;
  const waveInit = useRef<string>();
  useEffect(() => {
    const main = mainClips(project);
    if (!main.length || waveInit.current === name) return;
    waveInit.current = name;
    const sound = main.filter((c) => c.picture?.off || project.media.find((m) => m.id === c.mediaId)?.kind === 'audio').reduce((sum, c) => sum + clipDuration(c), 0);
    if (sound > main.reduce((sum, c) => sum + clipDuration(c), 0) / 2) useStore.getState().setLargeWave(true);
  }, [project, name]);
  // New layers can be inserted anywhere: reveal the actual new row.
  const rows = useRef<HTMLDivElement>(null);
  const previousTracks = useRef(project.tracks.map((t) => t.id));
  useEffect(() => {
    const added = project.tracks.find((t) => !previousTracks.current.includes(t.id));
    if (added) [...(rows.current?.querySelectorAll<HTMLElement>('[data-track-head]') ?? [])].find((el) => el.dataset.trackHead === added.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    previousTracks.current = project.tracks.map((t) => t.id);
  }, [project.tracks.length]);

  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (actionFor(comboOf(e)) !== 'deselect' || (!dragRef.current && !landingRef.current)) return;
      if (dragRef.current) e.preventDefault();
      e.stopImmediatePropagation();
      const d = dragRef.current;
      if (d?.kind === 'band') select(d.base);
      setDrag(undefined); setLanding(); setSnapAt(undefined); setDropIndex(undefined); pointer.current = undefined;
    };
    window.addEventListener('keydown', cancel, true);
    const end = () => { setLanding(); pointer.current = undefined; setSnapAt(undefined); };
    window.addEventListener('dragend', end);
    let frame = 0, last = 0;
    const tick = (now: number) => {
      const pt = pointer.current, d = dragRef.current, el = scroller.current, vertical = rows.current;
      if (pt && el && vertical && (pt.media || d?.kind === 'move' || d?.kind === 'trim')) {
        const b = el.getBoundingClientRect(), r = vertical.getBoundingClientRect();
        const speed = (v: number, lo: number, hi: number) => v < lo + 36 ? -Math.min(18, (lo + 36 - v) / 3) : v > hi - 36 ? Math.min(18, (v - hi + 36) / 3) : 0;
        const scale = Math.min(2, (now - last) / 16 || 1), x0 = el.scrollLeft, y0 = vertical.scrollTop;
        el.scrollLeft += speed(pt.clientX, b.left, b.right) * scale;
        vertical.scrollTop += speed(pt.clientY, r.top + RULER, r.bottom) * scale;
        if (el.scrollLeft !== x0 || vertical.scrollTop !== y0) (pt.media ? mediaRef : moveRef).current?.(pt);
      }
      last = now; frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { window.removeEventListener('keydown', cancel, true); window.removeEventListener('dragend', end); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    const el = scroller.current!;
    const update = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = scroller.current!;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.altKey) return;
      e.preventDefault();
      if (e.ctrlKey && e.shiftKey) {
        const list = ['compact', 'normal', 'large'] as const, v = useTimelineView.getState();
        v.setSize(list[Math.max(0, Math.min(2, list.indexOf(v.size) + (e.deltaY < 0 ? 1 : -1)))]); return;
      }
      const box = el.getBoundingClientRect(), s = useStore.getState(), t = (e.clientX - box.left + el.scrollLeft) / s.zoom;
      s.setZoom(s.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      requestAnimationFrame(() => { el.scrollLeft = t * useStore.getState().zoom - (e.clientX - box.left); });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  // keep the playhead in view while playing
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.time === prev.time || !scroller.current) return;
        const el = scroller.current;
        const x = s.time * s.zoom;
        if (s.playing && (x > el.scrollLeft + el.clientWidth - 80 || x < el.scrollLeft)) el.scrollLeft = x - 80;
      }),
    [],
  );

  const xToTime = (clientX: number) => {
    const el = scroller.current!;
    return Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft) / zoom);
  };

  // the magnet (N): drags catch on the playhead, other clips' edges and comments; Alt lets go for one drag
  const magnet = useStore((s) => s.magnet);
  const [snapAt, setSnapAt] = useState<number>();
  const catches = (e: { altKey: boolean }) => magnet && !e.altKey;
  const clampTime = (t: number) => Math.min(projectDuration(project), Math.max(0, t));
  const targets = useMemo(() => (except?: string, playhead = true) => timelineTargets(project, playhead ? useStore.getState().time : 0, except), [project]);
  const snap = (e: { altKey: boolean }, t: number, except?: string) => {
    const r = catches(e) ? snapTime(t, targets(except), 8 / zoom) : { t, at: undefined };
    setSnapAt(r.at);
    return r.t;
  };

  const capture = (e: React.PointerEvent) => { placementIds.current.clear(); e.preventDefault(); e.stopPropagation(); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); outer.current?.setPointerCapture(e.pointerId); };
  const snapCursor = (e: { altKey: boolean }, t: number, points: number[]) => {
    const r = catches(e) ? snapTime(clampTime(t), points, 8 / zoom) : { t: clampTime(t), at: undefined };
    setSnapAt(r.at);
    return clampTime(r.t);
  };
  const startScrub = (e: React.PointerEvent, grab = false) => {
    if (e.button !== 0) return;
    capture(e);
    const at = xToTime(e.clientX), offset = grab ? at - useStore.getState().time : 0;
    // The moving playhead must never become its own magnet target.
    const points = timelineTargets(project, undefined);
    if (!grab) seek(snapCursor(e, at, points));
    setDrag({ kind: 'scrub', offset, targets: points });
  };
  const startBand = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    capture(e);
    const box = content.current!.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top;
    setDrag({ kind: 'band', x0: x, y0: y, x, y, from: clampTime(xToTime(e.clientX)), to: clampTime(xToTime(e.clientX)), moved: false, mode: e.ctrlKey ? 'toggle' : e.shiftKey ? 'add' : 'replace', base: [...selected] });
  };
  const marks = { ...(drag?.kind === 'mark' ? drag.base : project.settings.marks) };
  if (drag?.kind === 'mark') {
    marks[drag.edge] = drag.value;
    if (marks.in !== undefined && marks.out !== undefined && marks.out < marks.in) [marks.in, marks.out] = [marks.out, marks.in];
  }
  const range = marks.in !== undefined && marks.out !== undefined ? [marks.in, marks.out] : undefined;
  const shownMarks = { in: marks.in ?? 0, out: marks.out ?? projectDuration(project) };

  const onPointerMove = (e: { clientX: number; clientY: number; altKey: boolean }) => {
    const drag = dragRef.current;
    if (!drag) return;
    pointer.current = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey };
    if (drag.kind === 'scrub') return seek(snapCursor(e, xToTime(e.clientX) - drag.offset, drag.targets));
    if (drag.kind === 'mark') return setDrag({ ...drag, value: snapCursor(e, xToTime(e.clientX) - drag.offset, drag.targets) });
    if (drag.kind === 'band') {
      const box = content.current!.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top;
      const next = { ...drag, x, y, to: clampTime(xToTime(e.clientX)), moved: drag.moved || Math.hypot(x - drag.x0, y - drag.y0) > 3 };
      if (next.moved) {
        const rows = [...content.current!.querySelectorAll<HTMLElement>('[data-track-row]')].map((r) => ({ id: r.dataset.trackRow!, top: r.getBoundingClientRect().top - box.top, bottom: r.getBoundingClientRect().bottom - box.top }));
        const hits = bandHits(project.clips, rows, { from: Math.min(next.from, next.to), to: Math.max(next.from, next.to), top: Math.min(next.y0, y), bottom: Math.max(next.y0, y) });
        const ids = bandSelection(next.base, hits, next.mode);
        if (ids.join(',') !== useStore.getState().selected.join(',')) select(ids);
      }
      return setDrag(next);
    }
    const dt = (e.clientX - drag.x0 + (scroller.current!.scrollLeft - drag.scroll0)) / zoom;
    if (drag.kind === 'trim') {
      const c = drag.clip;
      const media = project.media.find((m) => m.id === c.mediaId);
      const max = media?.kind === 'image' || !media ? Infinity : media.duration;
      if (drag.edge === 'in' && isLayer(c)) {
        // text / graphic: the left edge moves the start (the in-point stays, so the entrance plays)
        const start = Math.max(0, Math.min(clipEnd(c) - 0.1, snap(e, c.start + dt, c.id)));
        setDrag({ ...drag, value: c.in + (start - c.start) * c.speed });
      } else if (drag.edge === 'in') {
        const v = Math.min(c.out - 0.1, Math.max(0, c.in + dt * c.speed));
        setDrag({ ...drag, value: v });
      } else {
        let v = Math.max(c.in + 0.1, Math.min(max, c.out + dt * c.speed));
        v = Math.max(c.in + 0.1, Math.min(max, c.in + (snap(e, c.start + (v - c.in) / c.speed, c.id) - c.start) * c.speed));
        setDrag({ ...drag, value: v });
      }
    } else if (drag.kind === 'move') {
      // the track under the pointer, when the clip can go there (dropped: it moves to that track)
      const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-track-row]')?.dataset.trackRow;
      const target = project.tracks.find((t) => t.id === row);
      const over = drag.fixedTracks ? undefined : target && fitsTrack(drag.clip, target, project) ? target.id === drag.clip.trackId ? undefined : target.id : drag.over;
      const onMain = over === MAIN_TRACK || (!over && drag.clip.trackId === MAIN_TRACK);
      if (onMain) {
        // joining or reordering the main track: where it would go between the others
        const t = xToTime(e.clientX);
        const own = drag.clip.trackId === MAIN_TRACK;
        const order = mainClips(project).filter((c) => c.id !== drag.clip.id);
        const idx = order.findIndex((c) => t < c.start + clipDuration(c) / 2 - (own && c.start > drag.clip.start ? clipDuration(drag.clip) : 0));
        const index = idx < 0 ? order.length : idx;
        setDropIndex(index);
        setSnapAt(undefined);
        return setDrag({ ...drag, dx: dt * zoom, over, index, plan: undefined });
      }
      setDropIndex(undefined);
      // a free clip: whichever of its edges is nearer a target catches, and it's drawn there while dragging
      const groupStart = Math.min(...drag.group.map((c) => c.start)), groupEnd = Math.max(...drag.group.map(clipEnd));
      const raw = Math.max(0, groupStart + dt);
      const points = timelineTargets({ ...project, clips: project.clips.filter((c) => !drag.group.some((x) => x.id === c.id)) }, useStore.getState().time);
      const r = catches(e) ? snapSpan(raw, groupEnd - groupStart, points, 8 / zoom) : { start: raw, at: undefined };
      const delta = Math.max(0, r.start) - groupStart;
      setSnapAt(r.at);
      setDrag({ ...drag, dx: delta * zoom, over, plan: stablePlan(freeMoveOps(project, drag.group, delta, over)) });
    }
  };
  moveRef.current = onPointerMove;

  const onPointerUp = async (e: React.PointerEvent) => {
    if (dragRef.current?.kind === 'move' || dragRef.current?.kind === 'trim') onPointerMove(e);
    const d = dragRef.current;
    setDrag(undefined);
    setSnapAt(undefined);
    pointer.current = undefined;
    if (!d) return;
    if (d.kind === 'scrub') return;
    if (d.kind === 'mark') {
      if (Math.abs(d.value - d.base[d.edge]!) > .001) await ops([{ op: 'set_marks', ...d.base, [d.edge]: d.value }]);
      return;
    }
    if (d.kind === 'band') {
      if (!d.moved) { seek(d.from); if (d.mode === 'replace') select([]); }
      return;
    }
    if (d.kind === 'trim') {
      if (Math.abs(d.value - (d.edge === 'in' ? d.clip.in : d.clip.out)) <= 1e-3) return;
      if (d.edge === 'in' && isLayer(d.clip)) {
        const delta = (d.value - d.clip.in) / d.clip.speed;
        await ops([{ op: 'set_timing', clipId: d.clip.id, start: d.clip.start + delta, duration: clipDuration(d.clip) - delta }]);
      } else await ops([{ op: 'trim', clipId: d.clip.id, [d.edge]: d.value }]);
    } else if (d.kind === 'move') {
      const index = d.index;
      setDropIndex(undefined);
      if (d.over === MAIN_TRACK) {
        await ops([{ op: 'move', clipId: d.clip.id, trackId: MAIN_TRACK, index: index ?? mainClips(project).length }]);
      } else if (d.plan && (Math.abs(d.dx) >= 3 || d.over && d.over !== d.clip.trackId)) {
        await ops(d.plan);
      } else if (Math.abs(d.dx) < 3) {
        return;
      } else if (d.clip.trackId === MAIN_TRACK) {
        if (index !== undefined && index !== mainClips(project).findIndex((c) => c.id === d.clip.id)) await ops([{ op: 'reorder', clipId: d.clip.id, index }]);
        // a drag along the main track that changes nothing: say how it works instead of doing nothing
        else useStore.getState().notify('المسار الرئيسي لقطاته ورا بعض بدون فراغ: اسحب اللقطة بين لقطاته تتغيّر مكانها في الترتيب، أو اسحبها لمسار «بي-رول» وتحرّكها بحرية', 'info');
      }
    }
  };

  // ruler ticks
  const previewMedia = (e: { clientX: number; clientY: number; altKey: boolean }) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-track-row],[data-new-track],[data-insert-track]');
    if (!el) { setLanding(); setSnapAt(undefined); return; }
    const m = project.media.find((m) => m.id === draggingMediaId);
    let t = project.tracks.find((t) => t.id === el.dataset.trackRow);
    // A newly previewed row represents the original requested destination, not a persisted track.
    const previous = el.dataset.trackRow && !t ? landingRef.current?.request : undefined;
    if (previous?.trackId) t = project.tracks.find((t) => t.id === previous.trackId);
    const index = previous?.trackIndex ?? (el.dataset.insertTrack === undefined ? undefined : Number(el.dataset.insertTrack));
    const request: MediaTarget = { trackId: t?.id, newTrack: !t, trackIndex: index };
    const raw = xToTime(e.clientX), duration = m?.duration || 5;
    const r = t?.id === MAIN_TRACK ? { start: mainInsertion(project, raw).at } : catches(e) ? snapSpan(raw, duration, timelineTargets(project, useStore.getState().time), 8 / zoom) : { start: raw };
    request.at = Math.max(0, r.start);
    setSnapAt('at' in r ? r.at : undefined);
    const error = t && (t.kind === 'text' || m && !mediaFitsTrack(m, t)) ? t.kind === 'text' ? 'النص له مسار نص؛ اختر مسار صورة أو صوت' : 'هذا الملف لا يناسب هذا المسار' : undefined;
    const plan = m && !error ? stablePlan(mediaPlacementOps(project, m, request)) : [];
    const added = plan.find((o) => o.op === 'add_clip');
    setLanding({ trackId: added?.op === 'add_clip' ? added.clip.trackId : t?.id, at: request.at, duration, request, plan, mediaId: m?.id, label: m?.name ?? 'ملف جديد — المدة بعد الفحص', error, x: e.clientX, y: e.clientY });
  };
  mediaRef.current = previewMedia;
  const step = STEPS.find((s) => s * zoom >= 70) ?? 600;
  const ticks: number[] = [];
  for (let t = Math.floor(view.left / zoom / step) * step; t <= (view.left + view.width) / zoom; t += step) ticks.push(t);

  return (
    <div ref={outer} className="flex h-full flex-col border-t border-ink-800 bg-ink-900" dir="ltr" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { setDrag(undefined); setSnapAt(undefined); pointer.current = undefined; }}
      onDragEnter={(e) => { if (isFileDrag(e.dataTransfer) || e.dataTransfer.types.includes(MEDIA_DRAG)) { e.preventDefault(); e.stopPropagation(); } }}
      onDragLeave={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) { setLanding(); setSnapAt(undefined); pointer.current = undefined; } }}
      onDragOver={(e) => {
        if (!isFileDrag(e.dataTransfer) && !e.dataTransfer.types.includes(MEDIA_DRAG)) return;
        e.preventDefault(); e.stopPropagation();
        if (!pointer.current?.media) placementIds.current.clear();
        pointer.current = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey, media: true };
        previewMedia(e);
        e.dataTransfer.dropEffect = landingRef.current?.error ? 'none' : 'copy';
      }}
      onDrop={(e) => {
        if (!isFileDrag(e.dataTransfer) && !e.dataTransfer.types.includes(MEDIA_DRAG)) return;
        e.preventDefault(); e.stopPropagation();
        const next = landingRef.current;
        if (next && !next.error) {
          if (isFileDrag(e.dataTransfer)) importFiles([...e.dataTransfer.files], next.request);
          else placeMedia(e.dataTransfer.getData(MEDIA_DRAG) || draggingMediaId!, next.request);
        }
        setLanding(); setDraggingMedia(); setSnapAt(undefined); pointer.current = undefined;
      }}>
      <div className="timeline-toolbar flex shrink-0 items-center gap-3 border-b border-ink-800 px-3" dir="rtl">
        <span className="panel-title">التايملاين</span>
        <button className="btn btn-ghost text-xs" aria-label="تكبير مساحة التايملاين" aria-pressed={maximised} onClick={() => useTimelineView.getState().toggleMax()} title="تكبير / استعادة (Shift+F)">{maximised ? 'استعادة ↙' : 'توسيع ↗'}</button>
        <select className="rounded border border-ink-700 bg-ink-900 text-xs text-ink-300" aria-label="حجم المسارات" value={size} onChange={(e) => useTimelineView.getState().setSize(e.target.value as typeof size)}><option value="compact">مضغوط</option><option value="normal">عادي</option><option value="large">كبير</option></select>
        <div className="timeline-tools">
          <button className="btn btn-ghost timeline-tool" title="تقسيم عند المؤشر (S)" aria-label="تقسيم عند المؤشر" disabled={!project.clips.length} onClick={() => { const s = useStore.getState(); const target = project.clips.find((c) => selected.includes(c.id) && s.time > c.start && s.time < clipEnd(c)) ?? timelineToSource(project, s.time)?.clip; if (target && s.time > target.start && s.time < clipEnd(target)) ops([{ op: 'split', clipId: target.id, at: s.time }]); else s.notify('حرّك المؤشر داخل اللقطة لتقسيمها', 'info'); }}><Icon name="cut" size={16} /><span>تقسيم</span></button>
          <button className="btn btn-ghost timeline-tool" title="حذف المحدد (Delete)" aria-label="حذف المحدد" disabled={!selected.length && !range} onClick={async () => { if (!selected.length) return useStore.getState().deleteMarkedRange(); if (await ops(selected.map((id) => ({ op: 'delete' as const, clipId: id })))) select([]); }}><Icon name="trash" size={16} /></button>
          <button className="btn btn-ghost timeline-tool" title="إضافة نص" aria-label="إضافة نص" onClick={() => ops([{ op: 'add_text', text: 'نص جديد', start: useStore.getState().time, duration: 4, style: { preset: 'lower-third', animation: 'slide-up' } }])}><Icon name="text" size={16} /><span>نص</span></button>
          <GraphicPicker />
          <button className="btn btn-ghost timeline-tool magnet-toggle" aria-label="موجة صوت كبيرة" aria-pressed={largeWave} title="موجة صوت كبيرة (Shift+W)" onClick={() => useStore.getState().setLargeWave(!largeWave)}><Icon name="speaker" size={16} /><span>الموجة</span></button>
          <button className="btn btn-ghost timeline-tool" title="إضافة تعليق (C)" aria-label="إضافة تعليق" onClick={() => useStore.getState().startNote()}><Icon name="comment" size={16} /></button>
          <button className="btn btn-ghost timeline-tool magnet-toggle" aria-pressed={magnet} title={magnet ? 'المغناطيس شغّال (N) — اللقطات تلقط الحواف والمؤشر. Alt أثناء السحب يوقفه مؤقتًا' : 'المغناطيس طافي (N)'} aria-label="المغناطيس" onClick={() => useStore.getState().setMagnet(!magnet)}><Icon name="magnet" size={16} /></button>
        </div>
        {(marks.in !== undefined || marks.out !== undefined) && <div className="flex shrink-0 items-center gap-1 text-xs text-accent" data-marks-length><span className="num" dir="ltr">{range ? fmtTime(range[1] - range[0], 1) : `${marks.in !== undefined ? 'In' : 'Out'} ${fmtTime(marks.in ?? marks.out!, 1)}`}</span><button className="icon-button" aria-label="مسح علامات I/O" onClick={() => ops([{ op: 'set_marks', in: null, out: null }])}><Icon name="close" size={12} /></button></div>}
        <div className="flex-1" />
        <div className="timeline-zoom"><input aria-label="تكبير التايملاين" type="range" min={0} max={1} step={0.001} style={{ width: 100 }} value={Math.log(zoom) / Math.log(400)} onChange={(e) => setZoom(Math.pow(400, Number(e.target.value)))} />
        <button className="btn btn-ghost text-xs" title="عرض التايملاين كاملًا" onClick={() => setZoom((view.width - 40) / Math.max(5, projectDuration(project)))}>ملاءمة</button></div>
        <button className="icon-button" aria-label="عرض الاختصارات" onClick={() => useKeys.getState().setOpen(true)}><Icon name="keyboard" size={16} /></button>
      </div>
      {/* the ruler sits inside the sideways scroller, so CSS sticky cannot follow the vertical scroll: move it by hand */}
      <div ref={rows} data-timeline-rows className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden" onScroll={(e) => {
        const y = `translateY(${e.currentTarget.scrollTop}px)`;
        for (const el of e.currentTarget.querySelectorAll<HTMLElement>('[data-ruler]')) el.style.transform = y;
      }}>
        <div className="h-max shrink-0 border-r border-ink-800" style={{ width: HEAD }}>
          <div data-ruler style={{ height: RULER }} className="relative z-20 border-b border-ink-800 bg-ink-900"><div className="px-2 text-[10px] leading-[22px] text-ink-500" dir="rtl">حدود التصدير</div><AddTrack /></div>
          {tracks.map((t) => (
            <TrackHead key={t.id} track={t} ghost={!project.tracks.some((x) => x.id === t.id)} />
          ))}
          <div className="flex items-center px-2 text-[10px] text-ink-500" style={{ height: 38 }} dir="rtl">مسار جديد بالسحب</div>
          <div className="flex items-center gap-1 border-b border-ink-800 px-2 text-xs" style={{ height: NOTES_LANE }} dir="rtl">
            <span className="h-3 w-1 rounded bg-note" />
            <span className="flex-1 truncate text-ink-300">التعليقات</span>
            <button className="px-1 text-ink-400 hover:text-note" title="تعليق عند المؤشر (C)" onClick={() => useStore.getState().startNote()}>＋</button>
          </div>
        </div>
        <div ref={scroller} data-timeline-scroll className="relative h-max min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div ref={content} className="relative" style={{ width: contentW, minWidth: '100%' }}>
            <div
              data-ruler
              className="relative z-30 border-b border-ink-800 bg-ink-900"
              style={{ height: RULER }}
            >
              <div data-mark-lane className="absolute inset-x-0 top-0 border-b border-ink-800" style={{ height: MARKS }}>
                {range && <div data-marked-span className="pointer-events-none absolute inset-y-0 bg-accent/20" style={{ left: range[0] * zoom, width: (range[1] - range[0]) * zoom }} />}
                {marks.in === undefined && marks.out === undefined && <span className="pointer-events-none sticky left-7 px-2 text-[10px] leading-[22px] text-ink-500" dir="rtl">اسحب I / O لتحديد التصدير</span>}
                {(['in', 'out'] as const).map((edge) => !project.clips.length && marks[edge] === undefined ? null : <button key={edge} type="button" data-mark-edge={edge} data-default-mark={marks[edge] === undefined || undefined} className={`absolute top-px z-40 flex h-5 w-6 cursor-ew-resize items-center justify-center rounded border border-accent font-mono text-[11px] font-bold ${marks[edge] === undefined ? 'bg-ink-900 text-accent' : 'bg-accent text-ink-950'}`} style={{ left: shownMarks[edge] * zoom - 12 }} aria-label={edge === 'in' ? 'سحب بداية التصدير In' : 'سحب نهاية التصدير Out'} title={`${edge === 'in' ? 'In' : 'Out'} · ${fmtTime(shownMarks[edge], 3)} — اسحب بالمغناطيس؛ Alt يفكّه مؤقتًا`} onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  capture(e);
                  setDrag({ kind: 'mark', edge, value: shownMarks[edge], offset: xToTime(e.clientX) - shownMarks[edge], base: { ...shownMarks }, targets: timelineTargets(project, useStore.getState().time) });
                }}>{edge === 'in' ? '[I' : 'O]'}</button>)}
              </div>
              <div data-scrub-ruler className="absolute inset-x-0 bottom-0 cursor-crosshair" style={{ top: MARKS }} onPointerDown={(e) => startScrub(e)} title="انقر أو اسحب لتحريك المؤشر بالمغناطيس — مقابض التصدير في السطر العلوي">
                {ticks.map((t) => (
                  <div key={t} className="absolute top-0 h-full border-l border-ink-700 pl-1 text-[10px] text-ink-500" style={{ left: t * zoom }}>
                    <span className="num">{fmtTime(t, step < 1 ? 1 : 0)}</span>
                  </div>
                ))}
              </div>
            </div>
            {tracks.map((t, i) => (
              <div key={t.id} className="relative">
              {i > 0 && <div data-insert-track={i} className="track-insert-zone" title="اسحب هنا لإضافة مسار بين المسارين" />}
              <TrackRow
                key={t.id}
                track={t}
                project={project}
                name={name}
                zoom={zoom}
                view={view}
                analysis={analysis}
                selected={selected}
                drag={drag}
                dropIndex={drag?.kind === 'move' && t.id === MAIN_TRACK && (drag.over ?? drag.clip.trackId) === MAIN_TRACK ? dropIndex : undefined}
                dropTarget={drag?.kind === 'move' && drag.over === t.id}
                landing={landing?.trackId === t.id ? landing : undefined}
                onBackground={startBand}
                onClipDown={(e, c, part) => {
                  e.stopPropagation();
                  // right button: the clip menu opens (on contextmenu); keep a multi-selection that includes it
                  if (e.button === 2) { if (!selected.includes(c.id)) select([c.id]); return; }
                  if (e.button !== 0) return;
                  capture(e);
                  const now = performance.now();
                  if (lastDown.current.id === c.id && now - lastDown.current.at < 400) seek(c.start);
                  lastDown.current = { id: c.id, at: now };
                  const multi = e.shiftKey || e.ctrlKey;
                  const ids = multi ? [...new Set([...selected, c.id])] : selected.includes(c.id) ? selected : [c.id];
                  select(ids);
                  if (part === 'body') {
                    const free = project.clips.filter((x) => ids.includes(x.id) && x.trackId !== MAIN_TRACK);
                    const mixed = free.length > 0 && project.clips.some((x) => ids.includes(x.id) && x.trackId === MAIN_TRACK);
                    if (mixed && !mixedHint.current) { useStore.getState().notify('التحديد يجمع الأساسي وطبقات حرة؛ السحب يحرّك الطبقات الحرة فقط', 'info'); mixedHint.current = true; }
                    const group = free.length ? free : [c], anchor = mixed ? free[0] : c;
                    setDrag({ kind: 'move', clip: anchor, group, fixedTracks: mixed || free.length > 1, x0: e.clientX, scroll0: scroller.current!.scrollLeft, start: anchor.start, dx: 0 });
                  } else setDrag({ kind: 'trim', clip: c, edge: part, x0: e.clientX, scroll0: scroller.current!.scrollLeft, value: part === 'in' ? c.in : c.out });
                }}
                onClipDouble={(c) => seek(c.start)}
                onClipMenu={(e, c) => { e.preventDefault(); setMenu({ clip: c, x: e.clientX, y: e.clientY }); }}
              />
              </div>
            ))}
            <div data-new-track className="relative border-b border-dashed border-ink-700 text-xs text-ink-500" style={{ height: 38 }} onPointerDown={startBand}>
              <span className="sticky left-3 px-3 leading-9">اسحب ملفًا هنا لإضافة مسار</span>
              {landing && !landing.trackId && <GhostClip landing={landing} zoom={zoom} name={name} />}
            </div>
            <NotesLane zoom={zoom} xToTime={xToTime} />
            <TransitionMarks zoom={zoom} />
            <NoteBands zoom={zoom} />
            {range && <>
              <div data-marks-outside className="pointer-events-none absolute bottom-0 left-0 z-20 bg-ink-950/30" style={{ top: RULER, width: range[0] * zoom }} />
              <div className="pointer-events-none absolute bottom-0 right-0 z-20 bg-ink-950/30" style={{ top: RULER, left: range[1] * zoom }} />
            </>}
            {drag?.kind === 'band' && drag.moved && <div data-selection-band className="pointer-events-none absolute z-40 border border-accent bg-accent/15" style={{ left: Math.min(drag.x0, drag.x), top: Math.min(drag.y0, drag.y), width: Math.abs(drag.x - drag.x0), height: Math.abs(drag.y - drag.y0) }} />}
            <Playhead onScrub={(e) => startScrub(e, true)} />
            {snapAt !== undefined && (drag || landing) && <div className="snap-guide" style={{ left: snapAt * zoom }} aria-hidden="true" />}
          </div>
        </div>
      </div>
      {landing?.error && <div className="pointer-events-none fixed z-[70] rounded bg-cut px-2 py-1 text-xs text-ink-950" dir="rtl" style={{ left: Math.min(window.innerWidth - 270, landing.x + 12), top: landing.y + 16 }}>{landing.error}</div>}
      {menu && project.clips.some((c) => c.id === menu.clip.id) && <ClipMenu clip={project.clips.find((c) => c.id === menu.clip.id)!} x={menu.x} y={menu.y} onClose={closeMenu} />}
    </div>
  );
}

function TrackHead({ track, ghost }: { track: Track; ghost?: boolean }) {
  const ops = useStore((s) => s.ops);
  const largeWave = useStore((s) => s.largeWave);
  const size = useTimelineView((s) => s.size);
  const [renaming, setRenaming] = useState(false), [label, setLabel] = useState(track.name);
  const saveName = () => { setRenaming(false); if (label.trim() && label.trim() !== track.name) void ops([{ op: 'set_track', trackId: track.id, patch: { name: label.trim() } }]); };
  // sound: main, b-roll and music tracks; visibility: everything drawn on top of the main track
  const canMute = track.kind === 'audio' || track.kind === 'overlay' || track.id === MAIN_TRACK;
  const canHide = track.kind === 'overlay' || track.kind === 'text';
  const toggle = (on: boolean, label: string, onTitle: string, offTitle: string, icon: [IconName, IconName], patch: Partial<Track>) => (
    <button className={`flex h-5 w-5 items-center justify-center rounded text-[13px] transition-colors ${on ? 'bg-cut/25 text-cut-text' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'}`}
      title={on ? onTitle : offTitle} aria-label={label} aria-pressed={on}
      onClick={() => ops([{ op: 'set_track', trackId: track.id, patch }])}>
      <Icon name={on ? icon[1] : icon[0]} />
    </button>
  );
  const [manage, setManage] = useState(false);
  return (
    <div data-track-head={track.id} data-ghost-track={ghost || undefined} className="flex flex-col justify-center gap-1 border-b border-ink-800 px-2 text-xs" style={{ height: rowHeight(track, size, largeWave), opacity: ghost ? .6 : 1 }} dir="rtl">
      <div className="flex min-w-0 items-center gap-1 text-xs leading-4">
        <span className="h-3 w-1 shrink-0 rounded" style={{ background: COLOR[track.kind] }} />
        {renaming ? <input autoFocus aria-label="تسمية المسار" className="min-w-0 flex-1 bg-ink-950 text-ink-200" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} onBlur={saveName} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setRenaming(false); setLabel(track.name); } }} /> : <span onDoubleClick={() => { if (!ghost) { setLabel(track.name); setRenaming(true); } }} title="دبل كلك لتغيير اسم المسار" className={`flex-1 truncate ${track.muted || track.hidden ? 'text-ink-500 line-through' : 'text-ink-300'}`}>{ghost ? '＋ طبقة جديدة' : track.id === MAIN_TRACK && track.name === 'رئيسي' ? 'الأساسي' : track.name}</span>}
        {!ghost && <button className="text-ink-400 hover:text-ink-100" aria-label={`إدارة مسار ${track.name}`} onClick={() => setManage(true)}>⋯</button>}
      </div>
      {!ghost && <div className="flex items-center gap-1">
        {canMute && toggle(track.muted, 'كتم', 'مكتوم — اضغط عشان يرجع الصوت', 'كتم صوت المسار', ['speaker', 'speakerOff'], { muted: !track.muted })}
        {canHide && toggle(track.hidden, 'إخفاء', 'مخفي — اضغط عشان يظهر', 'إخفاء المسار', ['eye', 'eyeOff'], { hidden: !track.hidden })}
        {track.kind === 'audio' && <button className="truncate text-[10px] text-ink-400 hover:text-accent" aria-label={`نوع صوت ${track.name}`} title="كلام: بلا خفض أو تلاشي تلقائي؛ موسيقى: تنخفض تحت الكلام" onClick={() => ops([{ op: 'set_track', trackId: track.id, patch: { audio: track.audio === 'voice' ? 'music' : 'voice' } }])}>{track.audio === 'voice' ? 'كلام' : 'موسيقى'}</button>}
      </div>}
      {manage && <ManageTrack track={track} onClose={() => setManage(false)} />}
    </div>
  );
}

function AddTrack() {
  const [open, setOpen] = useState(false);
  return <>
    <button className="h-6 w-full text-xs text-ink-400 hover:text-accent" onClick={() => setOpen(true)}>＋ مسار</button>
    {open && <Modal title="إضافة مسار" subtitle="أضف ما تحتاجه الآن، وغيّر ترتيبه لاحقًا" onClose={() => setOpen(false)}>
      <div className="modal-body flex flex-col gap-2">{([['overlay', 'فيديو / صور فوقي'], ['text', 'نص'], ['audio', 'صوت']] as const).map(([kind, name]) => <button key={kind} className="btn justify-start" onClick={async () => {
        if (await useStore.getState().ops([{ op: 'add_track', track: { id: makeId(kind === 'audio' ? 'A' : kind === 'text' ? 'T' : 'V'), kind, name, ...(kind === 'audio' ? { audio: 'voice' as const } : {}) } }])) setOpen(false);
      }}>{name}</button>)}</div>
    </Modal>}
  </>;
}

function ManageTrack({ track, onClose }: { track: Track; onClose(): void }) {
  const project = useStore((s) => s.project)!;
  const [name, setName] = useState(track.name), [confirm, setConfirm] = useState(false);
  const index = project.tracks.findIndex((t) => t.id === track.id), main = track.id === MAIN_TRACK;
  const count = project.clips.filter((c) => c.trackId === track.id).length;
  const ops = useStore.getState().ops;
  return <Modal title={`إدارة مسار «${track.name}»`} onClose={onClose}>
    <form className="modal-body flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); if (name.trim() && await ops([{ op: 'set_track', trackId: track.id, patch: { name: name.trim() } }])) onClose(); }}>
      <label className="flex flex-col gap-1 text-xs">اسم المسار<input className="field" aria-label="اسم المسار" dir="auto" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} /></label>
      <button className="btn" disabled={!name.trim()} type="submit">حفظ الاسم</button>
      {!main && <div className="flex gap-2"><button type="button" className="btn" disabled={index <= 1} onClick={() => ops([{ op: 'move_track', trackId: track.id, index: index - 1 }])}>نقل لأعلى</button><button type="button" className="btn" disabled={index >= project.tracks.length - 1} onClick={() => ops([{ op: 'move_track', trackId: track.id, index: index + 1 }])}>نقل لأسفل</button></div>}
      {!main && <>
        {confirm && <p className="text-sm text-ink-300">حذف «{track.name}» مع {count} لقطة؟ يمكنك التراجع عن الحذف.</p>}
        <button type="button" className="btn btn-danger" onClick={async () => { if (count && !confirm) { setConfirm(true); return; } if (await ops([{ op: 'remove_track', trackId: track.id, deleteClips: !!count }])) onClose(); }}>{confirm ? `تأكيد حذف المسار و${count} لقطة` : 'حذف المسار'}</button>
      </>}
    </form>
  </Modal>;
}

/**
 * The comments lane under the tracks: drag a comment to move it, drag its end to make it a range
 * (or longer), double-click empty space to add one there. Click opens it in the comments panel.
 */
function NotesLane({ zoom, xToTime }: { zoom: number; xToTime: (clientX: number) => number }) {
  const notes = useStore((s) => s.project!.notes);
  const focus = useStore((s) => s.focusNote);
  const { showNote, startNote, preview, commit } = useStore.getState();
  const [drag, setDrag] = useState<{ id: string; kind: 'move' | 'end'; x0: number; at: number; end?: number; moved: boolean }>();
  const index = new Map(notes.map((n, i) => [n.id, i + 1]));

  const ops = (d: NonNullable<typeof drag>, clientX: number): Op[] => {
    const dt = (clientX - d.x0) / zoom;
    if (d.kind === 'move') {
      const at = Math.max(0, d.at + dt);
      return [{ op: 'update_note', id: d.id, patch: { at: r2(at), ...(d.end !== undefined ? { end: r2(at + d.end - d.at) } : {}) } }];
    }
    const end = Math.max(d.at + 0.2, (d.end ?? d.at) + dt);
    return [{ op: 'update_note', id: d.id, patch: { end: r2(end) } }];
  };

  return (
    <div className="relative border-b border-ink-800 bg-ink-950/40" style={{ height: NOTES_LANE }}
      onDoubleClick={(e) => { if (e.target === e.currentTarget) startNote(xToTime(e.clientX)); }}
      onPointerMove={(e) => { if (drag) { if (Math.abs(e.clientX - drag.x0) > 2) drag.moved = true; preview(ops(drag, e.clientX)); } }}
      onPointerUp={(e) => {
        const d = drag;
        setDrag(undefined);
        if (!d) return;
        if (d.moved) commit(ops(d, e.clientX)); else showNote(d.id);
      }}
      title="دبل كلك لتعليق جديد هنا">
      {notes.map((n) => {
        const done = n.status === 'done';
        const w = n.end !== undefined ? Math.max(22, (n.end - n.at) * zoom) : 22;
        return (
          <div key={n.id} className="group absolute top-1 flex h-[22px] cursor-grab items-center gap-1 overflow-hidden rounded-md px-1.5 text-[11px] font-semibold text-ink-950 active:cursor-grabbing"
            style={{ left: n.at * zoom, width: n.end !== undefined ? w : undefined, maxWidth: n.end !== undefined ? undefined : 220, background: done ? 'var(--color-ink-500)' : 'var(--color-note)', outline: n.id === focus ? '2px solid white' : undefined }}
            title={n.text}
            onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId); setDrag({ id: n.id, kind: 'move', x0: e.clientX, at: n.at, end: n.end, moved: false }); }}>
            <span className="shrink-0">{done ? '✓' : index.get(n.id)}</span>
            <span className="truncate font-normal" dir="auto">{n.text}</span>
            <span className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/20 opacity-0 group-hover:opacity-100" title="اسحب للمدى"
              onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget.parentElement!.parentElement as HTMLElement).setPointerCapture(e.pointerId); setDrag({ id: n.id, kind: 'end', x0: e.clientX, at: n.at, end: n.end ?? n.at + 22 / zoom, moved: false }); }} />
          </div>
        );
      })}
    </div>
  );
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Transitions on the main track: a bar across each cut as long as the blend; click selects the clip it leads into. */
function TransitionMarks({ zoom }: { zoom: number }) {
  const project = useStore((s) => s.project!);
  const largeWave = useStore((s) => s.largeWave);
  const size = useTimelineView((s) => s.size);
  const { select } = useStore.getState();
  const main = mainClips(project);
  return (
    <>
      {main.map((c, i) => {
        const h = transitionHalf(main[i - 1], c);
        if (!h) return null;
        return (
          <button key={c.id} className="absolute z-20 flex h-4 items-center justify-center rounded-sm border border-ink-950 bg-accent text-[9px] font-bold text-ink-950"
            style={{ top: RULER + rowHeight(project.tracks[0], size, largeWave) - 18, left: (c.start - h) * zoom, width: Math.max(10, 2 * h * zoom) }}
            title={`انتقال: ${c.transition!.kind} ${c.transition!.duration}ث`} onPointerDown={(e) => { e.stopPropagation(); select([c.id]); }}>
            ⧖
          </button>
        );
      })}
    </>
  );
}

/** The span a range comment covers, across all tracks. */
function NoteBands({ zoom }: { zoom: number }) {
  const notes = useStore((s) => s.project!.notes);
  return (
    <>
      {notes.filter((n) => n.end !== undefined && n.status === 'open').map((n) => (
        <div key={n.id} className="pointer-events-none absolute bottom-0 z-10 border-x border-note/60 bg-note/10" style={{ top: RULER, left: n.at * zoom, width: (n.end! - n.at) * zoom }} />
      ))}
    </>
  );
}

function Playhead({ onScrub }: { onScrub: (e: React.PointerEvent) => void }) {
  const time = useStore((s) => s.time);
  const zoom = useStore((s) => s.zoom);
  return (
    <div data-playhead className="pointer-events-none absolute top-0 h-full" style={{ left: time * zoom }}>
      <div data-playhead-line className="pointer-events-auto absolute bottom-0 -left-1 z-20 flex w-[9px] cursor-ew-resize justify-center" style={{ top: RULER }} onPointerDown={onScrub}><div className="h-full w-px bg-accent" /></div>
      {/* the head rides with the ruler when the rows scroll (data-ruler) */}
      <button type="button" data-ruler data-playhead-handle aria-label="سحب مؤشر التشغيل" title="اسحب المؤشر — يلتقط حدود القصات؛ Alt يفك المغناطيس" className="pointer-events-auto absolute -left-2 z-40 flex w-4 cursor-ew-resize justify-center" style={{ top: MARKS, height: RULER - MARKS }} onPointerDown={onScrub}><span className="h-0 w-0 border-x-[6px] border-t-[9px] border-x-transparent border-t-accent" /></button>
    </div>
  );
}

interface RowProps {
  track: Track;
  project: Project;
  name: string;
  zoom: number;
  view: { left: number; width: number };
  analysis: Record<string, Analysis>;
  selected: string[];
  drag?: Drag;
  dropIndex?: number;
  /** a clip dragged from another track would land here */
  dropTarget?: boolean;
  landing?: Landing;
  onBackground: (e: React.PointerEvent) => void;
  onClipDown: (e: React.PointerEvent, c: Clip, part: 'body' | 'in' | 'out') => void;
  onClipDouble: (c: Clip) => void;
  onClipMenu: (e: React.MouseEvent, c: Clip) => void;
}

function TrackRow({ track, project, name, zoom, view, analysis, selected, drag, dropIndex, dropTarget, landing, onBackground, onClipDown, onClipDouble, onClipMenu }: RowProps) {
  const largeWave = useStore((s) => s.largeWave);
  const size = useTimelineView((s) => s.size);
  const h = rowHeight(track, size, largeWave);
  const canvas = useRef<HTMLCanvasElement>(null);
  const clips = trackClips(project, track.id);
  const [, redraw] = useState(0);

  // draw filmstrip + waveform for the visible part only
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = devicePixelRatio;
    cv.width = Math.ceil(view.width * dpr);
    cv.height = h * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, view.width, h);
    const t0 = view.left / zoom, t1 = (view.left + view.width) / zoom;
    for (const c of clips) {
      const a = Math.max(c.start, t0), b = Math.min(clipEnd(c), t1);
      if (b <= a) continue;
      const data = c.mediaId ? analysis[c.mediaId] : undefined;
      const m = project.media.find((x) => x.id === c.mediaId);
      const x0 = c.start * zoom - view.left;
      const soundOnly = c.picture?.off || m?.kind === 'audio' || track.kind === 'audio';
      const wave = soundOnly ? h - 14 : track.kind === 'video' ? h * (largeWave ? 0.52 : 0.32) : track.kind === 'overlay' ? h - 14 : 0;
      // filmstrip
      if (!soundOnly && (track.kind === 'video' || track.kind === 'overlay') && data?.thumbs && m) {
        const th = data.thumbs;
        const ih = h - wave - 4;
        const iw = Math.round(ih * (th.w / th.h));
        ctx.save();
        ctx.beginPath();
        ctx.rect(Math.max(0, x0), 0, (clipEnd(c) - c.start) * zoom, h);
        ctx.clip();
        const firstX = Math.max(x0, Math.floor((view.left - c.start * zoom) / iw) * iw + c.start * zoom - view.left);
        for (let x = firstX; x < Math.min(view.width, x0 + clipDuration(c) * zoom); x += iw) {
          const tl = (x + view.left) / zoom;
          const src = c.in + (tl - c.start) * c.speed;
          const k = Math.min(th.count - 1, Math.max(0, Math.round(src / th.interval)));
          const sheet = th.sheets[Math.floor(k / (th.cols * th.rows))];
          if (!sheet) continue;
          const img = sprite(fileUrl(name, `analysis/${c.mediaId}/${sheet}`)!, () => redraw((n) => n + 1));
          if (!img.complete || !img.naturalWidth) continue;
          const j = k % (th.cols * th.rows);
          ctx.globalAlpha = 0.9;
          ctx.drawImage(img, (j % th.cols) * th.w, Math.floor(j / th.cols) * th.h, th.w, th.h, x, 2, iw, ih);
        }
        ctx.restore();
      } else if (!soundOnly && (track.kind === 'video' || track.kind === 'overlay') && m?.kind === 'image') {
        // a still (a photo, a held frame): the picture itself, repeated along the clip
        const img = sprite(fileUrl(name, m.path)!, () => redraw((n) => n + 1));
        if (img.complete && img.naturalWidth) {
          const ih = h - wave - 4, iw = Math.max(8, Math.round(ih * (img.naturalWidth / img.naturalHeight)));
          ctx.save();
          ctx.beginPath();
          ctx.rect(Math.max(0, x0), 0, clipDuration(c) * zoom, h);
          ctx.clip();
          ctx.globalAlpha = 0.9;
          for (let x = x0; x < Math.min(view.width, x0 + clipDuration(c) * zoom); x += iw) if (x + iw > 0) ctx.drawImage(img, x, 2, iw, ih);
          ctx.restore();
        }
      }
      // waveform
      if (wave && data?.peaks) {
        const pk = data.peaks;
        const base = h - 3;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = getComputedStyle(cv).getPropertyValue(`--color-clip-${m?.role === 'source' ? 'video' : track.kind === 'audio' ? 'audio' : 'overlay'}`).trim();
        const px0 = Math.max(0, x0), px1 = Math.min(view.width, (clipEnd(c) * zoom) - view.left);
        for (let x = px0; x < px1; x += 2) {
          const tl = (x + view.left) / zoom;
          const s0 = c.in + (tl - c.start) * c.speed;
          const s1 = s0 + (2 / zoom) * c.speed;
          let v = 0;
          for (let i = Math.floor(s0 * pk.rate); i <= Math.ceil(s1 * pk.rate); i++) v = Math.max(v, pk.data[i] ?? 0);
          const local = tl - c.start;
          const fade = Math.min(1, c.fadeIn ? local / c.fadeIn : 1) * Math.min(1, c.fadeOut ? (clipDuration(c) - local) / c.fadeOut : 1);
          const hh = Math.min(wave - 4, Math.max(0, v * volumeAt(c, local) * fade * (wave - 4)));
          ctx.fillRect(x, base - hh, 1.5, hh);
        }
        ctx.globalAlpha = 1;
      }
    }
    // pending cut suggestions on the main track
    if (track.id === MAIN_TRACK) {
      ctx.fillStyle = 'rgba(229,72,77,.28)';
      ctx.strokeStyle = 'rgba(229,72,77,.8)';
      for (const s of project.suggestions) {
        const a = sourceToTimeline(project, s.mediaId, s.t0), b = sourceToTimeline(project, s.mediaId, s.t1 - 0.001);
        if (a === null || b === null) continue;
        const x = a * zoom - view.left, w = Math.max(2, (b - a) * zoom);
        if (x > view.width || x + w < 0) continue;
        ctx.fillRect(x, 0, w, h);
        ctx.strokeRect(x + 0.5, 0.5, w - 1, h - 1);
      }
    }
  });

  return (
    <div className="relative border-b border-ink-800" data-track-row={track.id} data-drop={dropTarget || !!landing || undefined} style={{ height: h, opacity: track.muted || track.hidden ? 0.45 : 1 }} onPointerDown={onBackground}>
      {landing && (track.id === MAIN_TRACK ? <div data-media-insertion className="pointer-events-none absolute inset-y-0 z-50 w-0.5 bg-accent" style={{ left: landing.at * zoom }} /> : <GhostClip landing={landing} zoom={zoom} name={name} />)}
      <canvas ref={canvas} className="pointer-events-none absolute top-0 z-10" style={{ left: view.left, width: view.width, height: h }} />
      {/* visual ideas waiting for a yes, under the clips of the first overlay track: click one to see it in the assistant */}
      {track.id === project.tracks.find((t) => t.kind === 'overlay')?.id && project.ideas.map((idea) => {
        const span = ideaSpan(project, idea);
        if (!span) return null;
        return (
          <button key={idea.id} className="idea-mark" dir="rtl" style={{ left: span.start * zoom, width: Math.max(6, (span.end - span.start) * zoom) }}
            title={`${IDEA_KINDS[idea.kind]}: ${idea.note}`} aria-label={`فكرة: ${IDEA_KINDS[idea.kind]}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              const s = useStore.getState();
              s.seek(span.start);
              s.setPanel('assistant');
              requestAnimationFrame(() => document.getElementById(`idea-${idea.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
            }}>
            <span>{IDEA_KINDS[idea.kind]}</span>
          </button>
        );
      })}
      {clips.map((c) => {
        const sel = selected.includes(c.id);
        let left = c.start * zoom;
        let width = clipDuration(c) * zoom;
        let ghost = false;
        if (drag?.kind === 'trim' && drag.clip.id === c.id) {
          if (drag.edge === 'in') {
            const delta = (drag.value - c.in) / c.speed;
            if (c.trackId !== MAIN_TRACK) left += delta * zoom;
            width -= delta * zoom;
          } else width = ((drag.value - c.in) / c.speed) * zoom;
        }
        if (drag?.kind === 'move' && drag.group.some((x) => x.id === c.id)) {
          // over another track it stays put (dimmed); the landing box is drawn there
          if (!drag.plan && !drag.over) left += drag.dx;
          ghost = true;
        }
        if (width + left < view.left - 50 || left > view.left + view.width + 50) return null;
        const media = project.media.find((m) => m.id === c.mediaId);
        const gd = c.graphicData as { title?: unknown; label?: unknown } | undefined;
        const gName = c.graphic && `◆ ${c.graphic.replace(/^(graphics|lib)\//, '')}${gd?.title || gd?.label ? ` · ${gd.title || gd.label}` : ''}`;
        const label = c.text ?? c.label ?? media?.name ?? gName ?? '';
        return (
          <div
            key={c.id}
            data-clip-id={c.id}
            className="group absolute top-0 h-full overflow-hidden rounded-[5px]"
            style={{
              left, width: Math.max(2, width),
              background: track.kind === 'text' ? COLOR.text : `color-mix(in srgb, ${COLOR[track.kind]} 22%, transparent)`,
              outline: sel ? '2px solid var(--color-accent)' : `1px solid color-mix(in srgb, ${COLOR[track.kind]} 70%, black)`,
              outlineOffset: -1,
              opacity: ghost ? 0.6 : 1,
              zIndex: ghost ? 40 : sel ? 15 : 12,
              cursor: 'grab',
            }}
            onPointerDown={(e) => onClipDown(e, c, 'body')}
            onDoubleClick={() => onClipDouble(c)}
            onContextMenu={(e) => onClipMenu(e, c)}
            title={`${label}\n${fmtTime(c.start)} → ${fmtTime(clipEnd(c))}${c.speed !== 1 ? `  ×${c.speed}` : ''}`}
          >
            <div className="pointer-events-none absolute left-1.5 right-1.5 top-0.5 truncate text-[11px] font-medium text-white/90" dir="auto" style={{ textShadow: '0 1px 2px #000' }}>
              {c.speed !== 1 && <span className="mr-1 rounded bg-accent px-1 text-[10px] text-black">×{c.speed}</span>}
              {(c.grade || c.transform || c.picture || c.anim) && <span className="mr-1 text-accent">●</span>}
              {width > 40 ? label : ''}
              {(c.picture?.off || track.kind === 'audio') && <span className="ms-1">♪</span>}
            </div>
            {c.graphic && <SceneBands clip={c} zoom={zoom} width={width} />}
            {/* keyframes (zoom, place, opacity, volume): click one to put the playhead on it */}
            {keyTimes(c).filter((k) => k >= 0 && k <= clipDuration(c)).map((k) => (
              <button key={k} className="clip-key" style={{ left: k * zoom - 4 }} title={`مفتاح حركة ${fmtTime(c.start + k, 2)}`} aria-label="مفتاح حركة"
                onPointerDown={(e) => { e.stopPropagation(); useStore.getState().seek(c.start + k); }} />
            ))}
            <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/0 group-hover:bg-white/30" onPointerDown={(e) => onClipDown(e, c, 'in')} />
            <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/0 group-hover:bg-white/30" onPointerDown={(e) => onClipDown(e, c, 'out')} />
          </div>
        );
      })}
      {/* where a clip dragged from another track lands (the main track shows its insertion line instead) */}
      {drag?.kind === 'move' && drag.plan?.map((op) => {
        if (op.op !== 'move' || op.trackId !== track.id) return null;
        const c = project.clips.find((c) => c.id === op.clipId)!;
        const media = project.media.find((m) => m.id === c.mediaId);
        return <GhostClip key={c.id} zoom={zoom} name={name} landing={{ at: op.start!, duration: clipDuration(c), request: {}, plan: [], mediaId: c.mediaId, label: c.text ?? c.label ?? media?.name ?? 'رسمة', x: 0, y: 0 }} />;
      })}
      {trackOverlaps(project, track.id).map((span, i) => <div key={i} data-overlap-warning className="overlap-warning" style={{ left: span.start * zoom, width: (span.end - span.start) * zoom }} title="مقاطع متداخلة على المسار نفسه — انقل إحداها لطبقة أخرى" />)}
      {dropIndex !== undefined && (() => {
        if (drag?.kind !== 'move') return null;
        const order = clips.filter((c) => c.id !== drag.clip.id);
        // positions as they will be once the dragged clip is taken out
        const shifted = (c: Clip) => c.start - (drag.clip.trackId === track.id && c.start > drag.clip.start ? clipDuration(drag.clip) : 0);
        const at = dropIndex >= order.length ? (order.length ? shifted(order[order.length - 1]) + clipDuration(order[order.length - 1]) : 0) : shifted(order[dropIndex]);
        return <div className="absolute top-0 z-50 h-full w-0.5 bg-accent" style={{ left: at * zoom - 1 }} />;
      })()}
    </div>
  );
}

function GhostClip({ landing, zoom, name }: { landing: Landing; zoom: number; name: string }) {
  const media = useStore((s) => s.project?.media.find((m) => m.id === landing.mediaId));
  const thumbs = useStore((s) => s.analysis[landing.mediaId ?? '']?.thumbs);
  const url = media?.kind === 'image' ? fileUrl(name, media.path) : thumbs?.sheets[0] ? fileUrl(name, `analysis/${media?.id}/${thumbs.sheets[0]}`) : undefined;
  return <div data-landing-clip className={`landing-clip ${landing.error ? 'landing-invalid' : ''}`} style={{ left: landing.at * zoom, width: Math.max(6, landing.duration * zoom) }}>
    {url && <span className="h-full w-12 shrink-0 bg-cover bg-center" style={{ backgroundImage: `url("${url}")`, ...(media?.kind === 'video' && thumbs ? { backgroundSize: `${thumbs.cols * 100}% ${thumbs.rows * 100}%`, backgroundPosition: '0 0' } : {}) }} />}
    <span className="min-w-0 flex-1 truncate" dir="auto">{media?.kind === 'audio' ? '♪ ' : ''}{landing.label}</span><span className="num shrink-0 px-1">{fmtTime(landing.duration, 1)}</span>
  </div>;
}

/** A graphic's scenes on its clip: names, and dividers dragged to play the scene before longer or shorter. */
function SceneBands({ clip, zoom, width }: { clip: Clip; zoom: number; width: number }) {
  const project = useStore((s) => s.project)!;
  const scenes = useScenes(clip);
  const edges = scenes?.length ? sceneEdges(project, clip, scenes) : undefined;
  if (!edges) return null;
  const { list, now, opsFor } = edges;
  const x = (t: number) => ((t - clip.in) / clip.speed) * zoom;
  const drag = (e: React.PointerEvent, i: number) => {
    e.stopPropagation();
    e.preventDefault();
    const { preview, commit } = useStore.getState();
    const x0 = e.clientX, len0 = now[i] - now[i - 1];
    // the timeline runs left to right whatever the page direction
    const at = (ev: PointerEvent) => opsFor(i - 1, Math.max(0.1, Math.round((len0 + ((ev.clientX - x0) / zoom) * clip.speed) * 20) / 20));
    const move = (ev: PointerEvent) => preview(at(ev));
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (Math.abs(ev.clientX - x0) > 2) return void commit(at(ev));
      const { draftBase } = useStore.getState(); // a click: drop the preview
      if (draftBase) useStore.setState({ project: draftBase, draftBase: undefined });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  return (
    <>
      {list.map((sc, i) => {
        const a = x(now[i]), b = x(now[i + 1]);
        if (b < 0 || a > width) return null;
        return (
          <div key={i} className="pointer-events-none absolute bottom-0.5 truncate px-1 text-[9px] text-white/55" style={{ left: Math.max(0, a), width: Math.max(0, Math.min(width, b) - Math.max(0, a)) }} dir="auto">
            {b - a > 34 ? sc.name : ''}
          </div>
        );
      })}
      {now.slice(1, -1).map((t, j) => {
        const left = x(t);
        if (left <= 2 || left >= width - 2) return null;
        return (
          <div key={j} className="scene-divider" style={{ left: left - 4 }} title={`${list[j].name} | ${list[j + 1].name} — اسحب لتطويل أو تقصير «${list[j].name}»`}
            onPointerDown={(e) => drag(e, j + 1)} />
        );
      })}
    </>
  );
}
