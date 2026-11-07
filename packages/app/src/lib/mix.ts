import { clipDuration, volumeAt, type Clip, type Track } from '@edit/shared';
import { fadeGain } from './glgrade.ts';

export function trackGain(c: Clip, track: Track, time: number, duck = 1): number {
  if (track.muted) return 0;
  const music = track.kind === 'audio' && track.audio !== 'voice';
  return volumeAt(c, time - c.start) * fadeGain(c, time, music ? Math.min(1, clipDuration(c) / 4) : 0) * (music ? duck : 1);
}

/** Same threshold, ratio and attack/release as the render's sidechain compressor. */
export function duckGain(level: number, previous: number, dt: number): number {
  const target = level > .03 ? Math.pow(.03 / level, 1 - 1 / 8) : 1;
  return target + (previous - target) * Math.exp(-Math.max(0, dt) / (target < previous ? .02 : .4));
}
