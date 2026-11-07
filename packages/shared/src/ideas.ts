import { Clip, Note, TextStyle, Track, type Idea, type Project } from './schema.ts';
import { clipDuration, mainClips } from './timeline.ts';
import { SFX_TRACK } from './sfx.ts';

// Visual ideas (b-roll, graphics, words on screen, shots to film) proposed over the speech. They wait in
// project.ideas until the user adds or dismisses them; added, each becomes a clip on a free track at the
// moment its words play (or a comment, for footage the project doesn't have yet).

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const IDEA_KINDS: Record<Idea['kind'], string> = { graphic: 'رسمة', text: 'نص على الشاشة', broll: 'لقطة من ملفاتك', shot: 'لقطة تحتاجها' };

/** Where an idea plays on the timeline now: from its first surviving word, as long as its duration (or its words). Null when its words were cut. */
export function ideaSpan(p: Project, idea: Idea): { start: number; end: number } | null {
  let start: number | null = null, end: number | null = null;
  for (const c of mainClips(p)) {
    if (c.mediaId !== idea.mediaId || idea.t1 <= c.in || idea.t0 >= c.out) continue;
    const a = c.start + (Math.max(c.in, idea.t0) - c.in) / c.speed;
    const b = c.start + (Math.min(c.out, idea.t1) - c.in) / c.speed;
    start = start === null ? a : Math.min(start, a);
    end = end === null ? b : Math.max(end, b);
  }
  if (start === null || end === null) return null;
  const length = idea.duration ?? Math.max(2, end - start);
  return { start: r3(start), end: r3(start + length) };
}

/** What is missing for an idea of its kind to be added, or undefined when it is complete. */
export function ideaProblem(p: Project, idea: Pick<Idea, 'kind' | 'mediaId' | 't0' | 't1' | 'graphic' | 'text' | 'source'>): string | undefined {
  if (!p.media.some((m) => m.id === idea.mediaId)) return `media ${idea.mediaId} not found`;
  if (idea.t1 <= idea.t0) return 't1 must be after t0';
  if (idea.kind === 'graphic' && !/^(lib|graphics)\/[^/]+$/.test(idea.graphic ?? '')) return "a graphic idea needs graphic: 'lib/<template>' or 'graphics/<name>'";
  if (idea.kind === 'text' && !idea.text?.trim()) return 'a text idea needs text';
  if (idea.kind === 'broll') {
    const m = p.media.find((x) => x.id === idea.source?.mediaId);
    if (!m || m.kind === 'audio') return 'a broll idea needs source: {mediaId of a video or image in the project, in, out}';
    if (m.kind !== 'image' && idea.source!.out <= idea.source!.in) return 'broll source: out must be after in';
  }
  return undefined;
}

/** A track of this kind with nothing on it over [a, b] — or a new one, added to the project above the others of its kind. */
function freeTrack(p: Project, kind: 'overlay' | 'text', a: number, b: number): string {
  const busy = (t: Track) => p.clips.some((c) => c.trackId === t.id && c.start < b - 1e-3 && c.start + clipDuration(c) > a + 1e-3);
  const own = p.tracks.filter((t) => t.kind === kind && t.id !== SFX_TRACK);
  const free = own.find((t) => !busy(t));
  if (free) return free.id;
  const prefix = kind === 'overlay' ? 'V' : 'T';
  let n = own.length + 1;
  while (p.tracks.some((t) => t.id === `${prefix}${n}`)) n++;
  const id = `${prefix}${n}`;
  const last = p.tracks.map((t) => t.kind).lastIndexOf(kind);
  p.tracks.splice(last < 0 ? p.tracks.length : last + 1, 0, Track.parse({ id, kind, name: `${kind === 'overlay' ? 'بي-رول' : 'نصوص'} ${n}` }));
  return id;
}

/** Add an idea to the edit (in place): a clip on a free track, or a comment for a shot to film. False when its words were cut. */
export function placeIdea(p: Project, idea: Idea, newId: (prefix: string) => string): boolean {
  const span = ideaSpan(p, idea);
  if (!span) return false;
  const { start, end } = span;
  const length = r3(end - start);
  switch (idea.kind) {
    case 'graphic':
      p.clips.push(Clip.parse({ id: newId('c'), trackId: freeTrack(p, 'overlay', start, end), start, in: 0, out: length, graphic: idea.graphic, graphicData: idea.graphicData }));
      break;
    case 'text':
      p.clips.push(Clip.parse({
        id: newId('t'), trackId: freeTrack(p, 'text', start, end), start, in: 0, out: length, text: idea.text,
        textStyle: TextStyle.parse({ preset: 'title', animation: 'pop', ...idea.textStyle }),
      }));
      break;
    case 'broll': {
      const src = idea.source!;
      const m = p.media.find((x) => x.id === src.mediaId)!;
      // a still lasts as long as the idea; a video plays from its in-point, never past its out-point
      const len = m.kind === 'image' ? length : Math.min(length, src.out - src.in);
      // b-roll plays silent under the voice; the user can raise it
      p.clips.push(Clip.parse({ id: newId('c'), trackId: freeTrack(p, 'overlay', start, start + len), start, in: r3(src.in), out: r3(src.in + len), mediaId: m.id, volume: 0 }));
      break;
    }
    case 'shot':
      p.notes.push(Note.parse({ id: newId('n'), at: start, end, author: 'claude', text: `لقطة مقترحة: ${idea.note}${idea.search ? ` — ابحث عن: ${idea.search}` : ''}` }));
      p.notes.sort((a, b) => a.at - b.at);
      break;
  }
  return true;
}
