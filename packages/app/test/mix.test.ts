import { expect, it } from 'vitest';
import { Clip, Track } from '@edit/shared';
import { duckGain, trackGain } from '../src/lib/mix.ts';

it('voice never auto-fades or ducks; music fades and ducks, both respect user fades, keys and mute', () => {
  const c = Clip.parse({ id: 'c', trackId: 'A', start: 0, in: 0, out: 4 });
  const voice = Track.parse({ id: 'A', kind: 'audio', name: 'voice', audio: 'voice' });
  expect(trackGain(c, voice, .1, .1)).toBe(1);
  const music = { ...voice, audio: 'music' as const };
  expect(trackGain(c, music, .1, .1)).toBeCloseTo(.01);
  expect(trackGain({ ...c, fadeIn: 1 }, voice, .1, .1)).toBeCloseTo(.1);
  expect(trackGain(c, { ...voice, muted: true }, .1)).toBe(0);
  expect(duckGain(.3, 1, .1)).toBeLessThan(.2);
  expect(duckGain(0, .2, .1)).toBeGreaterThan(.2);
});
