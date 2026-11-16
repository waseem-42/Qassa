import type { Op, Project } from '@edit/shared';

export function volumeOps(project: Project, ids: string[], db: number): Op[] {
  return project.clips.filter((c) => ids.includes(c.id) && project.media.some((m) => m.id === c.mediaId && m.hasAudio) && !project.tracks.find((t) => t.id === c.trackId)?.locked)
    .map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { volume: Math.min(4, Math.max(0, (c.volume || (db > 0 ? .001 : 0)) * 10 ** (db / 20))) } }));
}
