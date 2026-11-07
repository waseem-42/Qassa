import { z } from 'zod';
import { Anim, Clip, Grade, GraphicEdit, Idea, MAIN_TRACK, Media, Note, Picture, Place, Project, Retime, Settings, StyleUse, Transition, Suggestion, TextStyle, Theme, Transform, Track, type Word } from './schema.ts';
import { EPS, clipDuration, clipEnd, mainClips, opacityAt, placeAt, projectDuration, sourceToTimeline, timelineToSource, transformAt } from './timeline.ts';
import { SFX_TRACK } from './sfx.ts';
import { pageToRetimed, retimedToPage } from './graphics.ts';
import { ideaProblem, placeIdea } from './ideas.ts';
import { sourceTiming, syncCaptionWords, type ClipId } from './caption-links.ts';
import { freeTrackFor } from './placement.ts';
import { presetPlace, textDirection } from './text.ts';

/** cut_words shortens leftover air across its cut only up to this long; longer gaps may be on-screen work. */
export const PAUSE_MAX = 3;

// Every edit — from the UI or from Claude — is one of these ops. The server applies a batch
// atomically, keeps a snapshot for undo and broadcasts the new project.

const id = z.string();
const animKeys = (p: keyof Anim) => Anim.shape[p].unwrap().nullable().optional();
export const ProjectDisplayName = z.string().trim().min(1).max(120).refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), 'display name must not contain control characters');
export const Op = z.discriminatedUnion('op', [
  z.object({ op: z.literal('restore_project'), project: Project }),
  z.object({ op: z.literal('rename_project'), name: ProjectDisplayName }),
  z.object({ op: z.literal('update_media'), mediaId: id, patch: z.object({ role: Media.shape.role.optional(), name: z.string().trim().min(1).max(200).optional() }).refine((x) => x.role !== undefined || x.name !== undefined, 'update_media: give a role or a name') }),
  z.object({ op: z.literal('set_marks'), in: z.number().finite().min(0).nullable().optional(), out: z.number().finite().min(0).nullable().optional() }),
  z.object({ op: z.literal('delete_range'), start: z.number().finite().min(0), end: z.number().finite().min(0) }),
  z.object({ op: z.literal('cut_range'), mediaId: id, t0: z.number(), t1: z.number() }),
  z.object({ op: z.literal('restore_range'), mediaId: id, t0: z.number(), t1: z.number() }),
  z.object({ op: z.literal('cut_words'), mediaId: id, from: z.number().int().min(0), to: z.number().int().min(0), pad: z.number().min(0).optional() }),
  z.object({ op: z.literal('speed_range'), mediaId: id, t0: z.number(), t1: z.number(), speed: z.number().min(0.25).max(16) }),
  z.object({ op: z.literal('keep_only'), mediaId: id, ranges: z.array(z.tuple([z.number(), z.number()])) }),
  z.object({ op: z.literal('split'), clipId: id, at: z.number() }),
  z.object({ op: z.literal('trim'), clipId: id, in: z.number().optional(), out: z.number().optional() }),
  /** start: a free clip's new time · trackId: another track (onto V1 a video/image joins the main track at `index`, off V1 it keeps its time) */
  z.object({ op: z.literal('move'), clipId: id, start: z.number().optional(), trackId: id.optional(), index: z.number().int().optional(), free: z.boolean().optional() }),
  z.object({ op: z.literal('reorder'), clipId: id, index: z.number().int() }),
  /** how a main-track clip comes in from the one before it; kind null removes it */
  z.object({ op: z.literal('set_transition'), clipIds: z.array(id), kind: Transition.shape.kind.nullable(), duration: z.number().min(0.1).max(3).optional() }),
  /** start / length of a clip off the main track, keeping its own in-point (a graphic keeps its entrance) */
  z.object({ op: z.literal('set_timing'), clipId: id, start: z.number().min(0).optional(), duration: z.number().positive().optional() }),
  /**
   * play a graphic's scenes longer/shorter: page edges `from` fall at clip seconds `to` (null = as authored).
   * Each clip keeps the part of the page it shows; pieces that followed one another still do.
   */
  z.object({ op: z.literal('retime_graphic'), clipIds: z.array(id).min(1), from: z.array(z.number().min(0)), to: z.array(z.number().min(0)).nullable(), hold: z.boolean().optional() }),
  z.object({ op: z.literal('delete'), clipId: id }),
  /** hold the frame under `at` for `duration` seconds: the clip is split there and the still (an image media of that frame) goes between */
  z.object({ op: z.literal('freeze_frame'), clipId: id, at: z.number(), mediaId: id, duration: z.number().min(0.1).max(60).default(2) }),
  /** the clip's sound becomes its own clip on an audio track (same timing); the clip itself goes silent */
  z.object({ op: z.literal('detach_audio'), clipId: id, trackId: id.optional() }),
  /** play another media (or another part) in the clip's place, keeping its settings — e.g. its reversed copy */
  z.object({ op: z.literal('replace_media'), clipId: id, mediaId: id, in: z.number().min(0), out: z.number().min(0) }),
  z.object({
    op: z.literal('add_clip'),
    clip: Clip.partial({ id: true, start: true, speed: true, volume: true }),
    index: z.number().int().optional(),
    free: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('update_clip'),
    clipId: id,
    patch: Clip.pick({ speed: true, volume: true, fadeIn: true, fadeOut: true, denoise: true, label: true, text: true, graphic: true, graphicData: true })
      .partial()
      .extend({
        grade: Grade.partial().nullable().optional(),
        transform: Transform.partial().nullable().optional(),
        place: Place.partial().nullable().optional(),
        picture: Picture.partial().extend({ crop: Picture.shape.crop.removeDefault().partial().optional() }).nullable().optional(),
        /** keyframes per property: an array replaces that property's keys ([] or null removes them); null removes all */
        anim: z.object({ dx: animKeys('dx'), dy: animKeys('dy'), scale: animKeys('scale'), opacity: animKeys('opacity'), volume: animKeys('volume') }).nullable().optional(),
        /** null on background / color / font = back to the preset's or the project identity's */
        textStyle: TextStyle.partial().extend({ background: z.string().nullable().optional(), color: z.string().nullable().optional(), font: z.string().nullable().optional() }).optional(),
        /** hand edits of elements inside a graphic page: the whole list (null or [] removes them) */
        graphicEdits: z.array(GraphicEdit).nullable().optional(),
      }),
  }),
  z.object({ op: z.literal('set_grade'), clipIds: z.array(id).optional(), grade: Grade.partial(), asDefault: z.boolean().optional() }),
  z.object({
    op: z.literal('add_text'),
    text: z.string(),
    start: z.number(),
    duration: z.number().positive(),
    trackId: id.optional(),
    style: TextStyle.partial().optional(),
    words: Clip.shape.words,
  }),
  z.object({ op: z.literal('set_settings'), patch: Settings.partial().extend({ defaultGrade: Grade.partial().nullable().optional(), theme: Theme.partial().optional(), captionStyle: TextStyle.partial().nullable().optional() }) }),
  z.object({ op: z.literal('add_track'), track: Track.partial({ magnetic: true, muted: true, hidden: true, audio: true }), index: z.number().int().optional() }),
  z.object({ op: z.literal('remove_track'), trackId: id, deleteClips: z.boolean().optional() }),
  z.object({ op: z.literal('move_track'), trackId: id, index: z.number().int().min(1) }),
  z.object({ op: z.literal('clear_track'), trackId: id }),
  z.object({ op: z.literal('set_track'), trackId: id, patch: Track.pick({ name: true, muted: true, hidden: true, audio: true }).partial() }),
  z.object({ op: z.literal('add_suggestions'), items: z.array(Suggestion.partial({ id: true, author: true })) }),
  z.object({ op: z.literal('resolve_suggestions'), ids: z.union([z.array(id), z.literal('all')]), accept: z.boolean() }),
  z.object({ op: z.literal('clear_suggestions'), author: z.enum(['analysis', 'claude', 'user']).optional() }),
  /** visuals proposed over the speech, for the user to add or dismiss (see ideas.ts) */
  z.object({ op: z.literal('add_ideas'), items: z.array(Idea.partial({ id: true, author: true })) }),
  /** accept: each idea becomes a clip on a free track where its words play (a shot: a comment); either way it leaves the list */
  z.object({ op: z.literal('resolve_ideas'), ids: z.union([z.array(id), z.literal('all')]), accept: z.boolean() }),
  z.object({ op: z.literal('log_style'), ...StyleUse.shape, at: StyleUse.shape.at.optional() }),
  z.object({ op: z.literal('set_style'), style: z.string().nullable() }),
  z.object({ op: z.literal('add_note'), note: Note.partial({ id: true, author: true, status: true }) }),
  z.object({ op: z.literal('update_note'), id, patch: Note.pick({ at: true, end: true, text: true, status: true, reply: true }).partial() }),
  z.object({ op: z.literal('delete_note'), id }),
]);
export type Op = z.infer<typeof Op>;
export const OpBatch = z.array(Op).min(1);

export class OpError extends Error {}

export interface OpContext {
  words?: (mediaId: string) => Word[] | undefined;
  newId?: (prefix: string) => string;
  /** Internal checkpoint transaction only; ordinary edit batches cannot replace a project. */
  allowProjectRestore?: boolean;
  report?: (message: string) => void;
}

let counter = 0;
export function makeId(prefix: string): string {
  counter = (counter + 1) % 1296;
  return prefix + Date.now().toString(36).slice(-5) + counter.toString(36).padStart(2, '0');
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

function need<T>(v: T | undefined | null, msg: string): T {
  if (v === undefined || v === null) throw new OpError(msg);
  return v;
}

/** Pack the magnetic main track: keep order by start, remove gaps. */
export function normalize(p: Project): void {
  let t = 0;
  for (const c of mainClips(p)) {
    c.start = r3(t);
    t += clipDuration(c);
  }
}

interface Anchor { clipId: string; mediaId?: string; src: number; fallback: number }

function anchorAt(p: Project, t: number): Anchor | undefined {
  const hit = timelineToSource(p, t);
  return hit ? { clipId: hit.clip.id, mediaId: hit.clip.mediaId, src: hit.src, fallback: t } : undefined;
}

/** Timeline time of an anchored moment after a main-track edit. */
function resolveAnchor(p: Project, a: Anchor): number {
  let t = sourceToTimeline(p, a.mediaId!, a.src, a.clipId);
  if (t === null) {
    // the content under it was cut: land on the next surviving moment of the same media
    const next = mainClips(p)
      .filter((k) => k.mediaId === a.mediaId && k.in >= a.src - EPS)
      .sort((x, y) => x.in - y.in)[0];
    t = next ? next.start : Math.min(a.fallback, mainClips(p).reduce((e, k) => Math.max(e, clipEnd(k)), 0));
  }
  return r3(Math.max(0, t));
}

/** Remember where every free clip and note sits relative to the main-track content under it. */
function anchorFreeClips(p: Project): Map<string, Anchor> {
  const m = new Map<string, Anchor>();
  const put = (key: string, a: Anchor | undefined) => a?.mediaId && m.set(key, a);
  for (const c of p.clips) if (c.trackId !== MAIN_TRACK && !c.words) put(c.id, anchorAt(p, c.start));
  for (const n of p.notes) {
    put(`note:${n.id}`, anchorAt(p, n.at));
    // a range's end belongs to the content just before it
    if (n.end !== undefined) put(`note-end:${n.id}`, anchorAt(p, Math.max(n.at, n.end - 0.01)));
  }
  return m;
}

/** After a main-track edit, move free clips and notes so they stay on the same content. */
function reanchor(p: Project, anchors: Map<string, Anchor>): void {
  for (const c of p.clips) {
    const a = anchors.get(c.id);
    // a free clip that just joined the main track is packed with it, not anchored
    if (a && c.trackId !== MAIN_TRACK) c.start = resolveAnchor(p, a);
  }
  for (const n of p.notes) {
    const a = anchors.get(`note:${n.id}`), b = anchors.get(`note-end:${n.id}`);
    if (a) n.at = resolveAnchor(p, a);
    if (b && n.end !== undefined) n.end = Math.max(n.at, r3(resolveAnchor(p, b) + 0.01));
  }
}

function getClip(p: Project, clipId: string): Clip {
  return need(p.clips.find((c) => c.id === clipId), `clip ${clipId} not found`);
}

function mediaDuration(p: Project, mediaId?: string): number {
  const m = p.media.find((x) => x.id === mediaId);
  // a still lasts as long as its clip: its "duration" is only the default length
  return (m?.kind !== 'image' && m?.duration) || Infinity;
}

function cutRange(p: Project, mediaId: string, t0: number, t1: number, newId: ClipId): void {
  if (t1 <= t0) throw new OpError('cut_range: t1 must be greater than t0');
  const next: Clip[] = [];
  for (const c of p.clips) {
    if (c.trackId !== MAIN_TRACK || c.mediaId !== mediaId || t1 <= c.in + EPS || t0 >= c.out - EPS) {
      next.push(c);
      continue;
    }
    if (t0 > c.in + EPS) next.push({ ...c, out: r3(t0) });
    if (t1 < c.out - EPS) {
      const keepsId = !(t0 > c.in + EPS);
      // nudge start so sorting keeps the tail right after the head
      next.push({ ...c, id: keepsId ? c.id : newId('c', c.id), in: r3(t1), start: c.start + 1e-6, transition: keepsId ? c.transition : undefined });
    }
  }
  p.clips = next;
}

function sameLook(a: Clip, b: Clip): boolean {
  return !b.transition && a.speed === b.speed && a.volume === b.volume && JSON.stringify([a.grade, a.transform, a.picture, a.anim, a.fadeIn, a.fadeOut]) === JSON.stringify([b.grade, b.transform, b.picture, b.anim, b.fadeIn, b.fadeOut]);
}

/** Keyframes are relative to the clip start: a piece that now starts `by` seconds later sees them earlier. */
function shiftKeyframes(c: Clip, by: number): void {
  if (!by) return;
  if (c.transform?.keyframes.length) c.transform = { ...c.transform, keyframes: c.transform.keyframes.map((k) => ({ ...k, t: r3(k.t - by) })) };
  if (c.anim) c.anim = Object.fromEntries(Object.entries(c.anim).map(([p, ks]) => [p, ks?.map((k) => ({ ...k, t: r3(k.t - by) }))]));
}

/** Merge main-track neighbours that play continuous source with the same settings. */
function mergeContiguous(p: Project, newId: ClipId): void {
  const clips = mainClips(p);
  const drop = new Set<string>();
  for (let i = 1; i < clips.length; i++) {
    const a = clips[i - 1], b = clips[i];
    if (drop.has(a.id)) continue;
    if (a.mediaId === b.mediaId && Math.abs(a.out - b.in) < EPS && sameLook(a, b) && !a.label && !b.label) {
      b.in = a.in;
      b.start = a.start;
      b.transition = a.transition; // b takes a's place, including how it comes in
      newId('c', a.id, b.id);
      drop.add(a.id);
    }
  }
  p.clips = p.clips.filter((c) => !drop.has(c.id));
}

function restoreRange(p: Project, mediaId: string, t0: number, t1: number, newId: ClipId): void {
  const dur = mediaDuration(p, mediaId);
  t0 = Math.max(0, t0);
  t1 = Math.min(dur, t1);
  const main = mainClips(p).filter((c) => c.mediaId === mediaId);
  // gaps of [t0,t1] not covered by any main clip
  const covered = main.map((c) => [c.in, c.out]).sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let cur = t0;
  for (const [a, b] of covered) {
    if (b <= cur) continue;
    if (a > cur + EPS) gaps.push([cur, Math.min(a, t1)]);
    cur = Math.max(cur, b);
    if (cur >= t1) break;
  }
  if (cur < t1 - EPS) gaps.push([cur, t1]);
  for (const [a, b] of gaps) {
    if (b - a < EPS) continue;
    const before = mainClips(p).filter((c) => c.mediaId === mediaId && c.out <= a + EPS).sort((x, y) => y.out - x.out)[0];
    const template = before ?? mainClips(p).find((c) => c.mediaId === mediaId);
    const start = before ? clipEnd(before) - 1e-6 : -1;
    p.clips.push({
      ...(template ?? { speed: 1, volume: 1 }),
      id: newId('c', template?.id),
      trackId: MAIN_TRACK,
      mediaId,
      in: r3(a),
      out: r3(b),
      start,
      label: undefined,
      transition: undefined,
    } as Clip);
    normalize(p);
  }
  mergeContiguous(p, newId);
}

export function applyOps(project: Project, ops: Op[], ctx: OpContext = {}): Project {
  let p: Project = structuredClone(project);
  const parents = new Map<string, Set<string>>();
  const newId: ClipId = (prefix, parent, existing) => {
    const id = existing ?? (ctx.newId ?? makeId)(prefix);
    if (parent) parents.set(id, new Set([...(parents.get(id) ?? []), parent, ...(parents.get(parent) ?? [])]));
    return id;
  };
  for (const op of ops) {
    if (op.op === 'restore_project') {
      if (!ctx.allowProjectRestore) throw new OpError('restore_project: use the checkpoint restore API');
      const next = Project.parse(structuredClone(op.project));
      if (next.createdAt !== p.createdAt) throw new OpError('restore_project: project identity does not match');
      const ids = (items: { id: string }[], kind: string) => {
        const values = new Set(items.map((item) => item.id));
        if (values.size !== items.length) throw new OpError(`restore_project: duplicate ${kind} IDs`);
        return values;
      };
      const mediaIds = ids(next.media, 'media'), trackIds = ids(next.tracks, 'track');
      ids(next.clips, 'clip'); ids(next.notes, 'note'); ids(next.suggestions, 'suggestion'); ids(next.ideas, 'idea');
      for (const clip of next.clips) {
        if (!trackIds.has(clip.trackId)) throw new OpError('restore_project: clip refers to a missing track');
        if (clip.mediaId && !mediaIds.has(clip.mediaId)) throw new OpError('restore_project: clip refers to missing media');
        if (clip.out <= clip.in) throw new OpError('restore_project: clip duration must be positive');
      }
      const paths = new Map(p.media.map((media) => [media.id, media.path]));
      if (next.media.some((media) => paths.has(media.id) && paths.get(media.id) !== media.path)) {
        throw new OpError('restore_project: an existing media ID cannot change its source path');
      }
      p = next;
    } else applyOne(p, op, ctx, newId);
  }
  // A complete saved state has its own timing. Do not silently rewrite it.
  if (ops.at(-1)?.op !== 'restore_project') {
    normalize(p);
    if (sourceTiming(project) !== sourceTiming(p)) syncCaptionWords(p, ctx.words, parents, newId);
  }
  return p;
}

function applyOne(p: Project, op: Op, ctx: OpContext, newId: ClipId): void {
  if (op.op === 'add_clip' || op.op === 'move') {
    const target = op.op === 'add_clip' ? op.clip.trackId : op.trackId;
    const kind = target === 'overlay' || target === 'audio' || target === 'text' ? target : undefined;
    if (op.free || kind) {
      const item = op.op === 'add_clip' ? Clip.parse({ ...op.clip, id: op.clip.id ?? newId('c'), start: op.clip.start ?? 0 }) : getClip(p, op.clipId);
      const preferred = kind ? undefined : target ?? item.trackId;
      if (preferred === MAIN_TRACK) throw new OpError('free placement needs an overlay, audio or text track');
      if (preferred && !p.tracks.some((t) => t.id === preferred)) throw new OpError(`track ${preferred} not found`);
      const start = r3(Math.max(0, op.op === 'add_clip' ? item.start : op.start ?? item.start));
      let placement = p;
      if (op.op === 'move' && item.trackId === MAIN_TRACK) {
        // Leaving V1 moves anchored layers: reserve against their resulting positions.
        placement = structuredClone(p);
        const anchors = anchorFreeClips(placement);
        placement.clips = placement.clips.filter((c) => c.id !== item.id);
        normalize(placement);
        reanchor(placement, anchors);
      }
      const plan = freeTrackFor(placement, item, start, start + clipDuration(item), preferred, op.op === 'move' ? [item.id] : [], kind);
      for (const trackOp of plan.ops) applyOne(p, trackOp, ctx, newId);
      op = op.op === 'add_clip' ? { ...op, free: false, clip: { ...item, trackId: plan.track.id } } : { ...op, free: false, trackId: plan.track.id };
    }
  }
  const touchesMain = (() => {
    switch (op.op) {
      case 'cut_range': case 'restore_range': case 'cut_words': case 'keep_only': case 'speed_range': return true;
      case 'split': case 'trim': case 'reorder': case 'delete': case 'update_clip': case 'freeze_frame':
        return p.clips.find((c) => c.id === op.clipId)?.trackId === MAIN_TRACK;
      case 'replace_media': {
        // same length: nothing moves, so free clips stay where they are (their anchors name the old media)
        const c = p.clips.find((x) => x.id === op.clipId);
        return c?.trackId === MAIN_TRACK && Math.abs((op.out - op.in) - (c.out - c.in)) > EPS;
      }
      case 'resolve_suggestions': return op.accept;
      case 'move': return op.trackId !== undefined && (op.trackId === MAIN_TRACK || p.clips.find((c) => c.id === op.clipId)?.trackId === MAIN_TRACK);
      case 'add_clip': return (op.clip.trackId ?? MAIN_TRACK) === MAIN_TRACK;
      default: return false;
    }
  })();
  const anchors = touchesMain ? anchorFreeClips(p) : null;

  switch (op.op) {
    case 'rename_project':
      p.name = ProjectDisplayName.parse(op.name);
      break;

    case 'set_marks': {
      const marks = { ...p.settings.marks };
      for (const key of ['in', 'out'] as const) {
        if (op[key] === null) delete marks[key];
        else if (op[key] !== undefined) marks[key] = r3(op[key]);
      }
      if (marks.in !== undefined && marks.out !== undefined && marks.out < marks.in) [marks.in, marks.out] = [marks.out, marks.in];
      p.settings.marks = marks;
      break;
    }

    case 'delete_range': {
      const start = Math.min(op.start, projectDuration(p)), end = Math.min(op.end, projectDuration(p));
      if (end <= start) throw new OpError('delete_range: end must follow start inside the project');
      const removed = end - start, next: Clip[] = [];
      const timeAfter = (t: number) => r3(t <= start ? t : t >= end ? t - removed : start);
      for (const c of p.clips) {
        if (c.words) { next.push(c); continue; }
        const stop = clipEnd(c);
        if (stop <= start || c.start >= end) { next.push({ ...c, start: timeAfter(c.start) }); continue; }
        if (c.graphic && !c.retime) c.retime = { from: [0, c.out], to: [0, c.out] };
        const head = c.start < start;
        if (head) next.push({ ...structuredClone(c), out: r3(c.in + (start - c.start) * c.speed), fadeOut: 0 });
        if (stop > end) {
          const off = end - c.start;
          const tail: Clip = { ...structuredClone(c), id: head ? newId('c', c.id) : c.id, start: r3(start), in: r3(c.in + off * c.speed), transition: undefined, fadeIn: Math.max(0, (c.fadeIn ?? 0) - off) };
          shiftKeyframes(tail, off);
          if (tail.text !== undefined && !tail.mediaId && !tail.graphic) { tail.out = r3(tail.out - tail.in); tail.in = 0; }
          next.push(tail);
        }
      }
      p.clips = next;
      for (const n of p.notes) { n.at = timeAfter(n.at); if (n.end !== undefined) { n.end = timeAfter(n.end); if (n.end <= n.at) delete n.end; } }
      break;
    }

    case 'cut_range':
      cutRange(p, op.mediaId, op.t0, op.t1, newId);
      break;

    case 'restore_range':
      restoreRange(p, op.mediaId, op.t0, op.t1, newId);
      break;

    case 'cut_words': {
      if (op.to < op.from) throw new OpError('cut_words: word range is reversed');
      const words = need(ctx.words?.(op.mediaId), `no transcript for ${op.mediaId}`);
      const a = need(words[op.from], `word ${op.from} not found`);
      const b = need(words[op.to], `word ${op.to} not found`);
      const pad = op.pad ?? 0.04;
      // cut up to the neighbouring words so the remaining speech keeps its breath
      const prevEnd = words[op.from - 1]?.t1 ?? 0;
      const nextStart = words[op.to + 1]?.t0 ?? mediaDuration(p, op.mediaId);
      const t0 = Math.min(a.t0, Math.max(prevEnd + pad, a.t0 - pad));
      const t1 = Math.max(b.t1, Math.min(nextStart - pad, b.t1 + pad));
      if (t1 > t0) cutRange(p, op.mediaId, t0, t1, newId);
      const clips = mainClips(p);
      const drop = new Set<string>();
      for (let i = 1; i < clips.length; i++) {
        if (clips[i - 1].mediaId !== op.mediaId || clips[i].mediaId !== op.mediaId || clips[i - 1].out > t0 + .001 || clips[i].in < t1 - .001) continue;
        let l = i - 1, r = i;
        const lastIn = (c: Clip) => words.filter((w) => w.t1 <= c.out + .001 && w.t0 >= c.in - .001).at(-1);
        const firstIn = (c: Clip) => words.find((w) => w.t0 >= c.in - .001 && w.t1 <= c.out + .001);
        const hasSpeech = (c: Clip) => words.some((w) => w.t1 > c.in + .001 && w.t0 < c.out - .001);
        // Earlier silence cuts can leave a speechless island beside the removed phrase.
        while (!hasSpeech(clips[l]) && l > 0 && clips[l - 1].mediaId === op.mediaId && clips[l - 1].out <= clips[l].in) l--;
        while (!hasSpeech(clips[r]) && r + 1 < clips.length && clips[r + 1].mediaId === op.mediaId && clips[r].out <= clips[r + 1].in) r++;
        const left = clips[l], right = clips[r], last = lastIn(left), next = firstIn(right);
        if (!last || !next) continue;
        const before = Math.max(0, (left.out - last.t1) / left.speed), after = Math.max(0, (next.t0 - right.in) / right.speed);
        const islands = clips.slice(l + 1, r);
        const air = before + after + islands.reduce((sum, c) => sum + clipDuration(c), 0);
        if (air <= .6 && !islands.length) continue;
        // a long speechless stretch may be the picture doing the work (a screen demo): leave it to the editor
        if (air > PAUSE_MAX) {
          ctx.report?.(`cut_words ${op.mediaId} ${op.from}–${op.to}: kept ${air.toFixed(2)}s without speech across the cut (longer than ${PAUSE_MAX}s, may be on-screen action) — look at it before cutting.`);
          continue;
        }
        const keepBefore = Math.min(before, Math.max(.06, .12 - after));
        const keepAfter = Math.min(after, .12 - keepBefore);
        left.out = r3(last.t1 + keepBefore * left.speed);
        const newIn = r3(next.t0 - keepAfter * right.speed);
        shiftKeyframes(right, (newIn - right.in) / right.speed);
        right.in = newIn;
        for (const island of islands) drop.add(island.id);
        ctx.report?.(`cut_words ${op.mediaId} ${op.from}–${op.to}: pause across cut shortened from ${air.toFixed(2)}s to ${(keepBefore + keepAfter).toFixed(2)}s.`);
      }
      p.clips = p.clips.filter((c) => !drop.has(c.id));
      break;
    }

    case 'speed_range': {
      // split main clips at the range edges, then speed up (or slow down) the middle
      if (op.t1 <= op.t0) throw new OpError('speed_range: t1 must be greater than t0');
      for (const edge of [op.t0, op.t1]) {
        const c = mainClips(p).find((k) => k.mediaId === op.mediaId && edge > k.in + EPS && edge < k.out - EPS);
        if (!c) continue;
        p.clips.push({ ...structuredClone(c), id: newId('c', c.id), in: r3(edge), start: c.start + (edge - c.in) / c.speed, transition: undefined });
        c.out = r3(edge);
        normalize(p);
      }
      for (const c of mainClips(p)) if (c.mediaId === op.mediaId && c.in >= op.t0 - EPS && c.out <= op.t1 + EPS) {
        c.speed = op.speed;
        // an automatic "x2" label follows the new speed; a label the user wrote stays
        if (c.label === undefined || /^x[\d.]+$/.test(c.label)) c.label = op.speed === 1 ? undefined : `x${op.speed}`;
      }
      break;
    }

    case 'keep_only': {
      // rebuild the media's presence on the main track from an explicit list of source ranges
      const ranges = [...op.ranges].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
      const originals = mainClips(p).filter((c) => c.mediaId === op.mediaId), template = originals[0];
      const firstStart = template?.start ?? Infinity;
      p.clips = p.clips.filter((c) => !(c.trackId === MAIN_TRACK && c.mediaId === op.mediaId));
      ranges.forEach(([a, b], i) => {
        const id = newId('c');
        for (const c of originals) if (c.in < b && c.out > a) newId('c', c.id, id);
        p.clips.push({ ...(template ?? { speed: 1, volume: 1 }), id, trackId: MAIN_TRACK, mediaId: op.mediaId, in: r3(a), out: r3(b), start: (Number.isFinite(firstStart) ? firstStart : 1e9) + i * 1e-6, label: undefined, transition: undefined } as Clip);
      });
      break;
    }

    case 'split': {
      const c = getClip(p, op.clipId);
      const src = c.in + (op.at - c.start) * c.speed;
      if (src <= c.in + EPS || src >= c.out - EPS) throw new OpError('split point is outside the clip');
      // both pieces keep playing one page: pin its length (GRAPHIC.duration) with an identity retime
      if (c.graphic && !c.retime) c.retime = { from: [0, c.out], to: [0, c.out] };
      const tail: Clip = { ...structuredClone(c), id: newId('c', c.id), in: r3(src), start: r3(op.at) + (c.trackId === MAIN_TRACK ? 1e-6 : 0), transition: undefined };
      shiftKeyframes(tail, op.at - c.start);
      c.out = r3(src);
      if (c.mediaId === undefined && !c.graphic) {
        // text clip: in/out are local seconds, so the tail restarts at 0
        tail.in = 0;
        tail.out = r3(tail.out - src);
      }
      p.clips.push(tail);
      break;
    }

    case 'trim': {
      const c = getClip(p, op.clipId);
      const dur = mediaDuration(p, c.mediaId);
      const nin = op.in ?? c.in;
      const nout = op.out ?? c.out;
      if (nin < 0 || nout > dur + EPS || nout - nin < 1 / 30) throw new OpError('trim: invalid in/out');
      if (c.trackId !== MAIN_TRACK && op.in !== undefined) c.start = r3(Math.max(0, c.start + (nin - c.in) / c.speed));
      c.in = r3(nin);
      c.out = r3(Math.min(nout, dur));
      break;
    }

    case 'move': {
      const c = getClip(p, op.clipId);
      if (op.trackId && op.trackId !== c.trackId) {
        const t = need(p.tracks.find((x) => x.id === op.trackId), `track ${op.trackId} not found`);
        const m = p.media.find((x) => x.id === c.mediaId);
        if (t.id === MAIN_TRACK) {
          if (!m) throw new OpError('only media clips can join the main track');
          // the main track fills the frame: a picture-in-picture place (and its keys) goes
          delete c.place;
          if (c.anim) {
            const { dx: _dx, dy: _dy, scale: _scale, ...rest } = c.anim;
            if (Object.keys(rest).length) c.anim = rest; else delete c.anim;
          }
          c.trackId = MAIN_TRACK;
          const order = mainClips(p).filter((x) => x.id !== c.id);
          order.splice(Math.max(0, Math.min(order.length, op.index ?? order.length)), 0, c);
          order.forEach((x, i) => (x.start = i));
          break;
        }
        // text goes on text (or overlay) tracks, graphics on overlays, sound on audio tracks, pictures on overlays
        const fits = c.text !== undefined && !c.mediaId ? t.kind === 'text' : c.graphic ? t.kind === 'overlay' : !!m && (t.kind === 'audio' ? m.kind === 'audio' || m.hasAudio : t.kind === 'overlay' && m.kind !== 'audio');
        if (!fits) {
          throw new OpError(`move: this clip can't go on ${t.name}`);
        }
        // off the main track: it keeps its time on the timeline, without the way it came in from the clip before
        if (c.trackId === MAIN_TRACK) delete c.transition;
        c.trackId = t.id;
      }
      if (op.start !== undefined) {
        if (c.trackId === MAIN_TRACK) throw new OpError('main-track clips are packed; use reorder');
        c.start = r3(Math.max(0, op.start));
      }
      break;
    }

    case 'set_transition':
      for (const cid of op.clipIds) {
        const c = getClip(p, cid);
        if (c.trackId !== MAIN_TRACK) throw new OpError('transitions are between main-track clips');
        if (op.kind === null) delete c.transition;
        else c.transition = Transition.parse({ ...c.transition, kind: op.kind, ...(op.duration !== undefined ? { duration: op.duration } : {}) });
      }
      break;

    case 'set_timing': {
      const c = getClip(p, op.clipId);
      if (c.trackId === MAIN_TRACK) throw new OpError('main-track clips are packed; use trim or reorder');
      if (op.start !== undefined) c.start = r3(op.start);
      if (op.duration !== undefined) {
        const out = c.in + op.duration * c.speed;
        if (out > mediaDuration(p, c.mediaId) + EPS) throw new OpError('set_timing: longer than the media');
        c.out = r3(out);
      }
      break;
    }

    case 'retime_graphic': {
      const r = op.to ? Retime.parse({ from: op.from, to: op.to, ...(op.hold ? { hold: true } : {}) }) : undefined;
      const clips = op.clipIds.map((cid) => getClip(p, cid)).sort((a, b) => a.start - b.start);
      let shift = 0, prevEnd = -Infinity;
      for (const c of clips) {
        if (!c.graphic) throw new OpError(`retime_graphic: clip ${c.id} is not a graphic`);
        const oldStart = c.start, oldEnd = clipEnd(c);
        // a piece that followed the previous one keeps following it
        if (Math.abs(oldStart - prevEnd) < EPS) c.start = r3(c.start + shift);
        const pin = retimedToPage(c.retime, c.in), pout = retimedToPage(c.retime, c.out);
        c.in = r3(Math.max(0, pageToRetimed(r, pin)));
        c.out = r3(pageToRetimed(r, pout));
        if (c.out - c.in < 1 / 30) throw new OpError('retime_graphic: a piece would be empty');
        if (r) c.retime = r;
        else delete c.retime;
        shift = clipEnd(c) - oldEnd;
        prevEnd = oldEnd;
      }
      break;
    }

    case 'reorder': {
      const c = getClip(p, op.clipId);
      if (c.trackId !== MAIN_TRACK) throw new OpError('reorder only applies to the main track');
      const order = mainClips(p).filter((x) => x.id !== c.id);
      const idx = Math.max(0, Math.min(order.length, op.index));
      order.splice(idx, 0, c);
      order.forEach((x, i) => (x.start = i));
      break;
    }

    case 'freeze_frame': {
      const c = getClip(p, op.clipId);
      if (p.media.find((m) => m.id === c.mediaId)?.kind !== 'video') throw new OpError('freeze_frame: only a video clip has frames to hold');
      const still = need(p.media.find((m) => m.id === op.mediaId && m.kind === 'image'), `freeze_frame: still ${op.mediaId} not found`);
      const main = c.trackId === MAIN_TRACK;
      const local = Math.min(Math.max(0, op.at - c.start), clipDuration(c));
      const at = c.start + local, src = c.in + local * c.speed;
      const tr = transformAt(c.transform, local);
      const freeze = Clip.parse({
        id: newId('c'), trackId: c.trackId, mediaId: still.id, start: at, in: 0, out: r3(op.duration), label: 'تجميد',
        // moving values are held at what they are at that moment
        grade: c.grade, ...(c.place || c.anim ? { place: Object.fromEntries(Object.entries(placeAt(c, local)).map(([k, v]) => [k, r4(v)])) } : {}),
        ...(c.picture || c.anim?.opacity ? { picture: { ...c.picture, opacity: r4(opacityAt(c, local)) } } : {}),
        ...(c.transform ? { transform: { scale: tr.scale, x: tr.x, y: tr.y } } : {}), // the zoom of that moment, held
      });
      // what plays after the still: the rest of the clip (split off), or the whole clip when frozen at its start
      let after: Clip | undefined;
      if (src > c.in + EPS && src < c.out - EPS) {
        after = { ...structuredClone(c), id: newId('c', c.id), in: r3(src), start: at, transition: undefined };
        shiftKeyframes(after, local);
        c.out = r3(src);
        p.clips.push(after);
      } else if (src <= c.in + EPS) {
        after = c;
        freeze.transition = c.transition; // the still now comes in the way the clip did
        delete c.transition;
      }
      if (main) {
        // packed in this order by normalize(): head, still, rest
        freeze.start = after === c ? at - 1e-6 : at + 5e-7;
        if (after && after !== c) after.start = at + 1e-6;
      } else if (after) after.start = r3(after.start + op.duration);
      p.clips.push(freeze);
      break;
    }

    case 'detach_audio': {
      const c = getClip(p, op.clipId);
      const m = p.media.find((x) => x.id === c.mediaId);
      if (!m || m.kind !== 'video' || !m.hasAudio) throw new OpError('detach_audio: the clip has no sound of its own');
      if (p.tracks.find((t) => t.id === c.trackId)?.kind === 'audio') throw new OpError('detach_audio: the clip is already on an audio track');
      if (c.volume === 0) throw new OpError('detach_audio: the clip is silent (its sound was detached already?)');
      const end = clipEnd(c);
      const free = (t: Track) => t.kind === 'audio' && t.audio === 'voice' && t.id !== SFX_TRACK && !p.clips.some((x) => x.trackId === t.id && x.start < end - EPS && clipEnd(x) > c.start + EPS);
      let track = op.trackId ? need(p.tracks.find((t) => t.id === op.trackId && t.kind === 'audio'), `audio track ${op.trackId} not found`) : p.tracks.find(free);
      if (!track) {
        let k = 2;
        while (p.tracks.some((t) => t.id === `A${k}`)) k++;
        track = Track.parse({ id: `A${k}`, kind: 'audio', name: 'صوت', audio: 'voice' });
        p.tracks.push(track);
      }
      p.clips.push(Clip.parse({
        id: newId('c'), trackId: track.id, mediaId: m.id, start: c.start, in: c.in, out: c.out, speed: c.speed, volume: c.volume,
        // its own fades only: an audio-track clip otherwise gets music's gentle rise and fall
        fadeIn: c.fadeIn ?? 0, fadeOut: c.fadeOut ?? 0, label: `صوت ${c.label ?? m.name}`,
      }));
      c.volume = 0;
      delete c.fadeIn;
      delete c.fadeOut;
      break;
    }

    case 'replace_media': {
      const c = getClip(p, op.clipId);
      const m = need(p.media.find((x) => x.id === op.mediaId), `media ${op.mediaId} not found`);
      const audioTrack = p.tracks.find((t) => t.id === c.trackId)?.kind === 'audio';
      if (audioTrack ? !m.hasAudio && m.kind !== 'audio' : c.trackId !== MAIN_TRACK && m.kind === 'audio') throw new OpError('replace_media: that media does not fit this track');
      if (op.out - op.in < 1 / 60 || op.out > mediaDuration(p, m.id) + EPS) throw new OpError('replace_media: invalid in/out');
      c.mediaId = m.id;
      c.in = r3(op.in);
      c.out = r3(Math.min(op.out, mediaDuration(p, m.id)));
      break;
    }

    case 'delete':
      getClip(p, op.clipId);
      p.clips = p.clips.filter((c) => c.id !== op.clipId);
      break;

    case 'add_clip': {
      const trackId = op.clip.trackId ?? MAIN_TRACK;
      const track = need(p.tracks.find((t) => t.id === trackId), `track ${trackId} not found`);
      if (op.clip.graphic && (track.magnetic || track.kind === 'audio')) throw new OpError('graphics go on an overlay track (V2), not on the main or audio track');
      const media = op.clip.mediaId ? need(p.media.find((m) => m.id === op.clip.mediaId), `media ${op.clip.mediaId} not found`) : undefined;
      if (track.kind === 'audio' && (!media || (!media.hasAudio && media.kind !== 'audio'))) throw new OpError('add_clip: an audio track needs media with sound');
      if (track.kind === 'text' && (media || op.clip.graphic || op.clip.text === undefined)) throw new OpError('add_clip: text only on a text track');
      if (op.clip.text !== undefined && track.kind !== 'text') throw new OpError('add_clip: text only on a text track');
      if (track.kind === 'overlay' && media?.kind === 'audio') throw new OpError('add_clip: use an audio track for sound');
      const clip = Clip.parse({
        speed: 1,
        volume: 1,
        ...op.clip,
        id: op.clip.id ?? newId('c'),
        trackId,
        in: op.clip.in ?? 0,
        out: op.clip.out ?? (media && media.kind !== 'image' ? media.duration : 5),
        start: op.clip.start ?? 0,
      });
      // a still has no length of its own (duration 0): give it a few seconds instead of an empty clip
      if (media?.kind === 'image' && clip.out - clip.in < 1 / 30) clip.out = clip.in + 5;
      if (clip.out - clip.in < 1 / 60) throw new OpError('add_clip: the clip is empty (out must be after in)');
      if (trackId === MAIN_TRACK) {
        const order = mainClips(p);
        const idx = op.index ?? order.length;
        order.splice(Math.max(0, Math.min(order.length, idx)), 0, clip);
        order.forEach((x, i) => (x.start = i));
      }
      p.clips.push(clip);
      break;
    }

    case 'update_clip': {
      const c = getClip(p, op.clipId);
      const { grade, transform, place, picture, anim, textStyle, graphicEdits, ...rest } = op.patch;
      Object.assign(c, rest);
      if (!c.denoise) delete c.denoise;
      if (graphicEdits === null || graphicEdits?.length === 0) delete c.graphicEdits;
      else if (graphicEdits) c.graphicEdits = graphicEdits;
      if (anim === null) delete c.anim;
      else if (anim) {
        const next: Record<string, unknown> = { ...c.anim };
        for (const [p, ks] of Object.entries(anim)) {
          if (ks === undefined) continue;
          if (ks === null || !ks.length) delete next[p];
          else next[p] = [...ks].sort((a, b) => a.t - b.t).map((k) => ({ ...k, t: r3(k.t) }));
        }
        if (Object.keys(next).length) c.anim = Anim.parse(next);
        else delete c.anim;
      }
      if (picture === null) delete c.picture;
      else if (picture) c.picture = Picture.parse({ ...c.picture, ...picture, crop: { ...c.picture?.crop, ...picture.crop } });
      if (grade === null) delete c.grade;
      else if (grade) c.grade = Grade.parse({ ...c.grade, ...grade });
      if (transform === null) delete c.transform;
      else if (transform) c.transform = Transform.parse({ ...c.transform, ...transform });
      if (place === null) delete c.place;
      else if (place) c.place = Place.parse({ ...c.place, ...place });
      if (textStyle) {
        const { background, color, font, ...restStyle } = textStyle;
        const next: Record<string, unknown> = { ...c.textStyle, ...restStyle };
        // null = the text's own value goes, and it follows the preset / the project identity again
        for (const [k, v] of [['background', background], ['color', color], ['font', font]] as const) {
          if (v === null) delete next[k];
          else if (v !== undefined) next[k] = v;
        }
        c.textStyle = TextStyle.parse(next);
      }
      break;
    }

    case 'set_grade': {
      if (op.asDefault) {
        p.settings.defaultGrade = Grade.parse({ ...p.settings.defaultGrade, ...op.grade });
        break;
      }
      const ids = op.clipIds ?? p.clips.filter((c) => c.mediaId && p.media.find((m) => m.id === c.mediaId)?.kind === 'video').map((c) => c.id);
      for (const cid of ids) {
        const c = getClip(p, cid);
        c.grade = Grade.parse({ ...c.grade, ...op.grade });
      }
      break;
    }

    case 'add_text': {
      let trackId = op.trackId ?? p.tracks.find((t) => t.kind === 'text')?.id;
      if (!trackId) { trackId = newId('T'); p.tracks.push(Track.parse({ id: trackId, kind: 'text', name: 'نصوص' })); }
      need(p.tracks.find((t) => t.id === trackId && t.kind === 'text'), 'no text track');
      p.clips.push(
        Clip.parse({ id: newId('t'), trackId, start: r3(op.start), in: 0, out: r3(op.duration), text: op.text, words: op.words, textStyle: TextStyle.parse({ ...presetPlace(op.style?.preset ?? 'title', textDirection(op.text, p.settings.theme)), ...op.style }) }),
      );
      break;
    }

    case 'set_settings': {
      const { defaultGrade, theme, captionStyle, ...rest } = op.patch;
      const next: Record<string, unknown> = { ...p.settings, ...rest };
      if (captionStyle === null) delete next.captionStyle;
      else if (captionStyle) next.captionStyle = captionStyle;
      if (theme) next.theme = Theme.parse({ ...p.settings.theme, ...theme });
      if (defaultGrade === null) delete next.defaultGrade;
      else if (defaultGrade) next.defaultGrade = Grade.parse({ ...p.settings.defaultGrade, ...defaultGrade });
      p.settings = Settings.parse(next);
      break;
    }

    case 'set_track': {
      const t = need(p.tracks.find((x) => x.id === op.trackId), `track ${op.trackId} not found`);
      Object.assign(t, op.patch);
      break;
    }

    case 'update_media': {
      const m = need(p.media.find((m) => m.id === op.mediaId), `media ${op.mediaId} not found`);
      if (op.patch.role !== undefined) m.role = op.patch.role;
      // only the shown name changes; the file on disk keeps its own
      if (op.patch.name !== undefined) m.name = need(op.patch.name.trim() || undefined, 'update_media: the name is empty');
      break;
    }

    case 'add_track': {
      if (p.tracks.some((t) => t.id === op.track.id)) break; // idempotent
      if (op.track.id === MAIN_TRACK || op.track.magnetic) throw new OpError('there is only one magnetic main track');
      const t = Track.parse({ ...op.track, magnetic: false });
      p.tracks.splice(Math.max(1, Math.min(p.tracks.length, op.index ?? p.tracks.length)), 0, t);
      break;
    }

    case 'remove_track': {
      need(p.tracks.find((t) => t.id === op.trackId), `track ${op.trackId} not found`);
      if (op.trackId === MAIN_TRACK) throw new OpError('the main track cannot be removed');
      if (!op.deleteClips && p.clips.some((c) => c.trackId === op.trackId)) throw new OpError('track is not empty; confirm deleting its clips');
      p.clips = p.clips.filter((c) => c.trackId !== op.trackId);
      p.tracks = p.tracks.filter((t) => t.id !== op.trackId);
      break;
    }

    case 'move_track': {
      const index = p.tracks.findIndex((t) => t.id === op.trackId);
      if (index < 0) throw new OpError(`track ${op.trackId} not found`);
      if (op.trackId === MAIN_TRACK) throw new OpError('the main track stays first');
      const [track] = p.tracks.splice(index, 1);
      p.tracks.splice(Math.min(op.index, p.tracks.length), 0, track);
      break;
    }

    case 'clear_track':
      if (op.trackId === MAIN_TRACK) throw new OpError('use keep_only or delete to change the main track');
      p.clips = p.clips.filter((c) => c.trackId !== op.trackId);
      break;

    case 'add_suggestions':
      for (const s of op.items) {
        if (s.t1 <= s.t0) continue;
        p.suggestions.push(Suggestion.parse({ author: 'claude', ...s, id: s.id ?? newId('s') }));
      }
      break;

    case 'resolve_suggestions': {
      const pick = op.ids === 'all' ? p.suggestions : p.suggestions.filter((s) => (op.ids as string[]).includes(s.id));
      if (op.accept) for (const s of pick) cutRange(p, s.mediaId, s.t0, s.t1, newId);
      const gone = new Set(pick.map((s) => s.id));
      p.suggestions = p.suggestions.filter((s) => !gone.has(s.id));
      break;
    }

    case 'clear_suggestions':
      p.suggestions = op.author ? p.suggestions.filter((s) => s.author !== op.author) : [];
      break;

    case 'add_ideas':
      for (const item of op.items) {
        const problem = ideaProblem(p, item);
        if (problem) throw new OpError(`add_ideas: ${problem}`);
        p.ideas.push(Idea.parse({ author: 'claude', ...item, id: item.id ?? newId('i') }));
      }
      p.ideas.sort((a, b) => a.t0 - b.t0);
      break;

    case 'resolve_ideas': {
      const pick = op.ids === 'all' ? p.ideas : p.ideas.filter((x) => (op.ids as string[]).includes(x.id));
      if (op.ids !== 'all' && pick.length < op.ids.length) throw new OpError('resolve_ideas: idea not found');
      if (op.accept) for (const idea of pick) placeIdea(p, idea, newId);
      const gone = new Set(pick.map((x) => x.id));
      p.ideas = p.ideas.filter((x) => !gone.has(x.id));
      break;
    }

    case 'log_style': {
      const { op: _op, ...entry } = op;
      const use = StyleUse.parse({ ...entry, at: entry.at ?? new Date().toISOString() });
      p.stylesUsed = [use, ...p.stylesUsed.filter((s) => s.id !== use.id)];
      break;
    }

    case 'set_style':
      p.style = op.style ?? undefined;
      break;

    case 'add_note': {
      const n = Note.parse({ ...op.note, id: op.note.id ?? newId('n') });
      if (n.end !== undefined && n.end <= n.at) delete n.end;
      p.notes.push(n);
      p.notes.sort((a, b) => a.at - b.at);
      break;
    }

    case 'update_note': {
      const n = need(p.notes.find((x) => x.id === op.id), `note ${op.id} not found`);
      Object.assign(n, op.patch);
      if (n.end !== undefined && n.end <= n.at) delete n.end;
      p.notes.sort((a, b) => a.at - b.at);
      break;
    }

    case 'delete_note':
      need(p.notes.find((x) => x.id === op.id), `note ${op.id} not found`);
      p.notes = p.notes.filter((x) => x.id !== op.id);
      break;
  }

  normalize(p);
  if (anchors) reanchor(p, anchors);
}
