import { applyOps, MAIN_TRACK, mediaPlacementOps, type Op, type Project } from '@edit/shared';

/** Reuse single-file placement, reserving each position before the next file. */
export function libraryPlacementOps(project: Project): Op[] {
  let draft = project;
  const ops: Op[] = [];
  for (const media of project.media) {
    if (media.kind !== 'video' && media.kind !== 'image') continue;
    const next = mediaPlacementOps(draft, media, { trackId: MAIN_TRACK });
    draft = applyOps(draft, next);
    ops.push(...next);
  }
  return ops;
}
