import { MAIN_TRACK, Track, type Clip, type Media, type Project } from './schema.ts';
import { clipEnd, clipDuration } from './timeline.ts';
import { makeId, type Op } from './ops.ts';

export function clipFitsTrack(p: Project, item: Clip | Media, track: Track): boolean {
  const clip = 'path' in item ? undefined : item;
  const media = 'path' in item ? item : p.media.find((m) => m.id === item.mediaId);
  if (track.id === MAIN_TRACK) return !!media;
  if (clip?.text !== undefined && !clip.mediaId) return track.kind === 'text';
  if (clip?.graphic) return track.kind === 'overlay';
  return !!media && (track.kind === 'audio' ? media.kind === 'audio' || media.hasAudio : track.kind === 'overlay' && media.kind !== 'audio');
}

/** An opt-in placement plan. Explicit track ops may still intentionally overlap. */
export function freeTrackFor(p: Project, item: Clip | Media, start: number, end: number, preferTrackId?: string, except: string[] = [], kind?: Track['kind'], insertIndex?: number): { track: Track; ops: Op[]; index?: number } {
  const preferred = p.tracks.find((t) => t.id === preferTrackId);
  const family = kind ?? preferred?.kind ?? ('path' in item ? item.kind === 'audio' ? 'audio' : 'overlay' : item.text !== undefined ? 'text' : 'overlay');
  const free = (t: Track) => t.id !== MAIN_TRACK && !t.locked && t.kind === family && (family !== 'audio' || !preferred || t.audio === preferred.audio) && clipFitsTrack(p, item, t) && !p.clips.some((c) => !except.includes(c.id) && c.trackId === t.id && c.start < end - .001 && clipEnd(c) > start + .001);
  const index = preferred ? p.tracks.indexOf(preferred) : p.tracks.length;
  if (insertIndex === undefined) {
    const found = [...p.tracks].sort((a, b) => Math.abs(p.tracks.indexOf(a) - index) - Math.abs(p.tracks.indexOf(b) - index)).find(free);
    if (found) return { track: found, ops: [] };
  }
  const track = Track.parse({ id: makeId(family === 'audio' ? 'A' : family === 'text' ? 'T' : 'V'), kind: family === 'video' ? 'overlay' : family, name: family === 'audio' ? 'صوت' : family === 'text' ? 'نص' : 'فيديو / صور', audio: preferred?.audio ?? 'music' });
  const at = Math.max(1, Math.min(p.tracks.length, insertIndex ?? index));
  return { track, index: at, ops: [{ op: 'add_track', track }, { op: 'move_track', trackId: track.id, index: at }] };
}

/** Every member gets the same time delta; reserve each destination before placing the next. */
export function freeMoveOps(p: Project, clips: Clip[], delta: number, preferred?: string): Op[] {
  const free = clips.filter((c) => c.trackId !== MAIN_TRACK || preferred && preferred !== MAIN_TRACK);
  if (!free.length) return [];
  delta = Math.max(delta, -Math.min(...free.map((c) => c.start)));
  const draft = { ...p, tracks: [...p.tracks], clips: p.clips.filter((c) => !free.some((x) => x.id === c.id)) };
  const ops: Op[] = [];
  for (const c of free) {
    const start = Math.round((c.start + delta) * 1000) / 1000;
    const plan = freeTrackFor(draft, c, start, start + clipDuration(c), preferred ?? c.trackId);
    ops.push(...plan.ops, { op: 'move', clipId: c.id, trackId: plan.track.id, start });
    if (plan.ops.length) draft.tracks.splice(plan.index!, 0, plan.track);
    draft.clips.push({ ...c, trackId: plan.track.id, start });
  }
  return ops;
}

/** Intersections are drawn above every clip, so covered content cannot disappear silently. */
export function trackOverlaps(p: Project, trackId: string): { start: number; end: number }[] {
  if (trackId === MAIN_TRACK) return [];
  const clips = p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
  const spans: { start: number; end: number }[] = [];
  let end = -Infinity;
  for (const c of clips) {
    if (c.start < end - .001) spans.push({ start: c.start, end: Math.min(end, clipEnd(c)) });
    end = Math.max(end, clipEnd(c));
  }
  return spans;
}

/** Warn only about intersections introduced or enlarged by this batch. */
export function newOverlapWarnings(before: Project, after: Project): string[] {
  const intersections = (p: Project) => {
    const spans = new Map<string, { a: Clip; b: Clip; start: number; end: number }>();
    for (const track of p.tracks) {
      if (track.id === MAIN_TRACK) continue;
      const clips = p.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
      for (let i = 0; i < clips.length; i++) for (let j = i + 1; j < clips.length && clips[j].start < clipEnd(clips[i]) - .001; j++) {
        const a = clips[i], b = clips[j], start = Math.max(a.start, b.start), end = Math.min(clipEnd(a), clipEnd(b));
        if (end > start + .001) spans.set(JSON.stringify([track.id, ...[a.id, b.id].sort()]), { a, b, start, end });
      }
    }
    return spans;
  };
  const old = intersections(before), warnings: string[] = [];
  const name = (c: Clip) => `${c.label ?? c.text ?? after.media.find((m) => m.id === c.mediaId)?.name ?? c.graphic ?? c.id} (${c.id})`.replace(/\s+/g, ' ');
  for (const [key, span] of intersections(after)) {
    const prev = old.get(key);
    if (prev && span.end - span.start <= prev.end - prev.start + .001) continue;
    warnings.push(`Overlap on ${span.a.trackId}: ${name(span.a)} / ${name(span.b)}, ${span.start.toFixed(2)}–${span.end.toFixed(2)}s; use free:true to place on a free track.`);
  }
  return warnings;
}
