import { MAIN_TRACK, type Clip, type Op, type Project } from '@edit/shared';

// Copy / paste a clip's look onto other clips (CapCut "paste attributes", Resolve "paste attributes"):
// colours, zoom, picture (fit, crop, flip, rotation, opacity), size/position of a layer, volume, sound fades and voice cleanup —
// with their keyframes — or a text's style. Never its timing, media or words.

type Patch = Extract<Op, { op: 'update_clip' }>['patch'];
export type LookKind = 'media' | 'text' | 'graphic';
export interface Look { kind: LookKind; from: string; patch: Patch; layer: boolean }

export const lookKind = (c: Clip): LookKind => (c.graphic ? 'graphic' : c.mediaId ? 'media' : 'text');

export function lookOf(c: Clip): Look {
  const kind = lookKind(c), layer = c.trackId !== MAIN_TRACK;
  if (kind === 'text') return { kind, from: c.id, layer, patch: { textStyle: { ...c.textStyle, background: c.textStyle?.background ?? null } } };
  if (kind === 'graphic') return { kind, from: c.id, layer, patch: { place: c.place ?? null, picture: c.picture ?? null, anim: c.anim ?? null } };
  return {
    kind, from: c.id, layer,
    patch: {
      // null = the source has none: the target loses its own too, so both look the same
      grade: c.grade ?? null, transform: c.transform ?? null, picture: c.picture ?? null, anim: c.anim ?? null,
      // a silent source (its sound detached, or muted) does not pass its silence on
      ...(c.volume > 0 ? { volume: c.volume } : {}),
      ...(layer ? { place: c.place ?? null } : {}),
      ...(c.fadeIn !== undefined ? { fadeIn: c.fadeIn } : {}),
      ...(c.fadeOut !== undefined ? { fadeOut: c.fadeOut } : {}),
      denoise: c.denoise ?? 0,
    },
  };
}

/** The ops that give `ids` the copied look; clips of another kind (a text from a video…) are skipped. */
export function pasteLookOps(p: Project, look: Look, ids: string[]): Op[] {
  const ops: Op[] = [];
  for (const c of p.clips.filter((x) => ids.includes(x.id) && x.id !== look.from && lookKind(x) === look.kind)) {
    const patch: Patch = { ...look.patch };
    if (look.kind === 'media') {
      const audioOnly = p.media.find((m) => m.id === c.mediaId)?.kind === 'audio' || p.tracks.find((t) => t.id === c.trackId)?.kind === 'audio';
      if (audioOnly) {
        for (const k of ['grade', 'transform', 'picture', 'place'] as const) delete patch[k];
        patch.anim = { volume: look.patch.anim?.volume ?? null }; // only the sound moves on a sound
      }
      // a layer's place means nothing on the magnetic main track (and the other way round: keep the layer's own)
      if (c.trackId === MAIN_TRACK || !look.layer) delete patch.place;
    }
    ops.push({ op: 'update_clip', clipId: c.id, patch });
  }
  return ops;
}
