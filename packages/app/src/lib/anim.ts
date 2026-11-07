import { animValue, type AnimProp, type Clip, type Ease, type Key, type Keyframe, type Op } from '@edit/shared';

// Keyframes in the editor, the CapCut / Resolve way: a property without keys has one value; once it has keys,
// changing it (slider, drag on the preview) sets the key at the playhead, and ◆ adds or removes that key.

type Patch = Extract<Op, { op: 'update_clip' }>['patch'];

/** keys closer than this to the playhead are the key "at" it */
export const KEY_NEAR = 0.04;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const keyAtTime = (keys: Key[] | undefined, t: number) => keys?.find((k) => Math.abs(k.t - t) < KEY_NEAR);

/** `keys` with the value `v` at time t (replacing a key right there, keeping its ease), in time order */
export function withKey(keys: Key[] | undefined, t: number, v: number): Key[] {
  const ease = keyAtTime(keys, t)?.ease;
  return [...(keys ?? []).filter((k) => Math.abs(k.t - t) >= KEY_NEAR), { t: r3(t), v: r3(v), ...(ease ? { ease } : {}) }].sort((a, b) => a.t - b.t);
}

export const EASES: [Ease, string][] = [['smooth', 'ناعم'], ['linear', 'ثابت'], ['in', 'يتسارع'], ['out', 'يتباطأ'], ['hold', 'قفزة']];

/** The key at the playhead with another ease (how the value moves from it to the next key). */
export function easePatch(c: Clip, p: AnimProp, t: number, e: Ease): Patch {
  const keys = c.anim?.[p] ?? [];
  return { anim: { [p]: keys.map((k) => (Math.abs(k.t - t) < KEY_NEAR ? (e === 'smooth' ? { t: k.t, v: k.v } : { ...k, ease: e }) : k)) } };
}

/** Zoom/focus keys with this one set at time t (replacing a key right there, keeping its ease), in time order. */
export function withZoomKey(kfs: Keyframe[] | undefined, k: Omit<Keyframe, 'ease'>): Keyframe[] {
  const ease = kfs?.find((x) => Math.abs(x.t - k.t) < KEY_NEAR)?.ease;
  return [...(kfs ?? []).filter((x) => Math.abs(x.t - k.t) >= KEY_NEAR), { ...k, t: r3(k.t), ...(ease ? { ease } : {}) }].sort((a, b) => a.t - b.t);
}

/** The zoom key at the playhead with another ease. */
export function zoomEasePatch(c: Clip, t: number, e: Ease): Patch {
  const kfs = c.transform?.keyframes ?? [];
  return { transform: { keyframes: kfs.map((k) => (Math.abs(k.t - t) < KEY_NEAR ? (e === 'smooth' ? { t: k.t, scale: k.scale, x: k.x, y: k.y } : { ...k, ease: e }) : k)) } };
}

/** The patch that gives the clip these values at time t of the clip: keyed properties get a key there, the rest their fixed value. */
export function valuesPatch(c: Clip, values: Partial<Record<AnimProp, number>>, t: number): Patch {
  const patch: Patch = {};
  const anim: NonNullable<Patch['anim']> = {};
  for (const [p, v] of Object.entries(values) as [AnimProp, number][]) {
    if (c.anim?.[p]?.length) anim[p] = withKey(c.anim[p], t, v);
    else if (p === 'opacity') patch.picture = { opacity: r3(v) };
    else if (p === 'volume') patch.volume = r3(v);
    else patch.place = { ...patch.place, [p]: r3(v) };
  }
  if (Object.keys(anim).length) patch.anim = anim;
  return patch;
}

/** ◆ at the playhead: add a key with the value it has now, or remove the key that is there (the last one leaves the value it had). */
export function toggleKeyPatch(c: Clip, p: AnimProp, t: number): Patch {
  const keys = c.anim?.[p];
  const here = keyAtTime(keys, t);
  if (!here) {
    // the first key: the property starts moving from its current value
    return { anim: { [p]: withKey(keys, t, animValue(c, p, t)) } };
  }
  const rest = keys!.filter((k) => k !== here);
  if (rest.length) return { anim: { [p]: rest } };
  return { anim: { [p]: null }, ...valuesPatch({ ...c, anim: undefined }, { [p]: here.v }, t) };
}

/** Times of the keys of a clip (any property, zoom included), for jumping between them. */
export function keyTimes(c: Clip): number[] {
  const all = [...Object.values(c.anim ?? {}).flatMap((ks) => ks?.map((k) => k.t) ?? []), ...(c.transform?.keyframes.map((k) => k.t) ?? [])];
  return [...new Set(all.map(r3))].sort((a, b) => a - b);
}
