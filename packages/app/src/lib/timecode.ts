/**
 * A typed time, as the transport clock accepts it: «83» or «83.5» seconds, «1:23», «1:02:03», Arabic digits and
 * «،»/«٫» too; «+5» / «-2» move from `now`. Returns timeline seconds clamped to [0, total], or null when unreadable.
 */
export function parseTimecode(input: string, now: number, total: number): number | null {
  const s = input.trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٫,،]/g, '.').replace(/[؛;]/g, ':').replace(/\s+/g, '');
  const m = /^([+-]?)((?:\d+:){0,2}\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const parts = m[2].split(':').map(Number);
  if (parts.slice(1).some((v) => v >= 60)) return null;
  const seconds = parts.reduce((acc, v) => acc * 60 + v, 0);
  const t = m[1] === '+' ? now + seconds : m[1] === '-' ? now - seconds : seconds;
  return Math.max(0, Math.min(total, t));
}
