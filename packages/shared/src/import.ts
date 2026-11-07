import { MAIN_TRACK, Picture, Track, type Media, type Project } from './schema.ts';
import { clipDuration, clipEnd, mainClips } from './timeline.ts';
import { makeId, OpError, type Op } from './ops.ts';
import { freeTrackFor } from './placement.ts';

export interface MediaTarget { trackId?: string; at?: number; newTrack?: boolean; trackIndex?: number; soundOnly?: boolean }

export function guessedRole(p: Project, kind: Media['kind'], target?: MediaTarget): Media['role'] {
  if (kind === 'audio') {
    const track = p.tracks.find((t) => t.id === target?.trackId);
    if (track?.id === MAIN_TRACK || track?.audio === 'voice') return 'source';
    if (track?.kind === 'audio' || target?.newTrack) return 'music';
  }
  return mainClips(p).length === 0 ? 'source' : kind === 'audio' ? 'music' : 'broll';
}

export function mediaFitsTrack(m: Media, t: Track): boolean {
  if (t.id === MAIN_TRACK) return true;
  if (t.kind === 'audio') return m.kind === 'audio' || m.hasAudio;
  return t.kind === 'overlay' && m.kind !== 'audio';
}

export function mainInsertion(p: Project, at: number): { index: number; at: number } {
  const order = mainClips(p);
  const i = order.findIndex((c) => at < c.start + clipDuration(c) / 2);
  const index = i < 0 ? order.length : i;
  return { index, at: order[index]?.start ?? (order.length ? clipEnd(order[order.length - 1]) : 0) };
}

/** Uploads and card drags use the same undoable placement, independent of the role chip. */
export function mediaPlacementOps(p: Project, m: Media, target: MediaTarget = {}): Op[] {
  const at = Math.max(0, target.at ?? 0);
  const ops: Op[] = [];
  if (target.soundOnly && !m.hasAudio && m.kind !== 'audio') throw new OpError('هذا الملف لا يحتوي على صوت');
  let track = target.trackId ? p.tracks.find((t) => t.id === target.trackId) : undefined;
  if (target.trackId && !track) throw new OpError('المسار لم يعد موجودًا');
  if (track && !mediaFitsTrack(m, track)) throw new OpError('هذا الملف لا يناسب المسار؛ اختر مسار صورة أو صوت');
  if (!track && !target.newTrack) {
    const kind = target.soundOnly ? 'audio' : m.role === 'source' ? 'video' : m.kind === 'audio' ? 'audio' : 'overlay';
    track = p.tracks.find((t) => t.kind === kind && (!target.soundOnly || t.audio === 'voice') && (kind === 'video' || !p.clips.some((c) => c.trackId === t.id && c.start < at + m.duration && clipEnd(c) > at)));
  }
  if (!track) {
    const kind = m.kind === 'audio' || target.soundOnly ? 'audio' : 'overlay';
    track = Track.parse({ id: makeId(kind === 'audio' ? 'A' : 'V'), kind, name: kind === 'audio' ? 'صوت' : 'فيديو / صور', audio: target.soundOnly ? 'voice' : 'music' });
    ops.push({ op: 'add_track', track });
    if (target.trackIndex !== undefined) ops.push({ op: 'move_track', trackId: track.id, index: Math.max(1, target.trackIndex) });
  } else if (track.id !== MAIN_TRACK) {
    const plan = freeTrackFor(p, m, at, at + (m.duration || 5), track.id);
    track = plan.track;
    ops.push(...plan.ops);
  }
  const insert = track.id === MAIN_TRACK ? mainInsertion(p, target.at ?? Infinity) : undefined;
  ops.push({ op: 'add_clip', index: insert?.index, clip: {
    trackId: track.id, mediaId: m.id, in: 0, out: m.duration || 5, start: insert?.at ?? at,
    volume: target.soundOnly ? 1 : m.role === 'music' && track.kind === 'audio' ? .35 : track.kind === 'overlay' ? 0 : 1,
    ...(m.kind === 'video' && track.kind === 'audio' ? { picture: Picture.parse({ off: true }), fadeIn: 0, fadeOut: 0 } : {}),
  } });
  return ops;
}
