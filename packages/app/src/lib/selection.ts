import { clipEnd, type Clip } from '@edit/shared';

export function bandHits(clips: Clip[], rows: { id: string; top: number; bottom: number }[], span: { from: number; to: number; top: number; bottom: number }): string[] {
  const tracks = new Set(rows.filter((r) => r.top <= span.bottom && r.bottom >= span.top).map((r) => r.id));
  return clips.filter((c) => tracks.has(c.trackId) && c.start <= span.to && clipEnd(c) >= span.from).map((c) => c.id);
}

export function bandSelection(base: string[], hits: string[], mode: 'replace' | 'add' | 'toggle'): string[] {
  if (mode === 'replace') return hits;
  if (mode === 'add') return [...new Set([...base, ...hits])];
  return [...base.filter((id) => !hits.includes(id)), ...hits.filter((id) => !base.includes(id))];
}
