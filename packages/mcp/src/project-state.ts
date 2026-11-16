/** Full state is opt-in; targeted reads keep graphic data and clip settings intact. */
export function projectState(r: any, options: { full?: boolean; from?: number; limit?: number; clipIds?: string[] } = {}) {
  if (options.full) return r;
  const all = r.project.clips, from = options.from ?? 0, limit = options.limit ?? 40;
  const clips = options.clipIds ? all.filter((c: any) => options.clipIds!.includes(c.id)) : all.slice(from, from + limit);
  return { ...r, project: { ...r.project, clips }, clipWindow: { total: all.length, shown: clips.length, from: options.clipIds ? undefined : from, truncated: clips.length < all.length, next: !options.clipIds && from + clips.length < all.length ? from + clips.length : undefined }, hint: 'Use project_summary first; clipIds for exact settings, from/limit for more clips, full:true only when the entire JSON is needed.' };
}
