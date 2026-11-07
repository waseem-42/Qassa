import type { Project, Suggestion } from './schema.ts';
import { mainClips } from './timeline.ts';

/** Measure only surviving timeline content, counting overlapping proposals once. */
export function reviewSavings(project: Project, suggestions: Suggestion[]): number {
  return mainClips(project).reduce((total, clip) => {
    const ranges = suggestions.filter((s) => s.mediaId === clip.mediaId)
      .map((s) => [Math.max(clip.in, s.t0), Math.min(clip.out, s.t1)])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
      .sort((a, b) => a[0] - b[0]);
    let end = -Infinity, removed = 0;
    for (const [a, b] of ranges) {
      removed += Math.max(0, b - Math.max(a, end));
      end = Math.max(end, b);
    }
    return total + removed / clip.speed;
  }, 0);
}

export function reviewTime(project: Project, suggestion: Suggestion): number | null {
  for (const clip of mainClips(project)) {
    if (clip.mediaId === suggestion.mediaId && suggestion.t1 > clip.in && suggestion.t0 < clip.out) {
      return clip.start + (Math.max(clip.in, suggestion.t0) - clip.in) / clip.speed;
    }
  }
  return null;
}
