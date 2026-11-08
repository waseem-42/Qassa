import { expect, it } from 'vitest';
import { parseTimecode } from '../src/lib/timecode.ts';

it('reads seconds, m:ss, h:mm:ss, Arabic digits and relative jumps', () => {
  const at = (s: string, now = 10, total = 4000) => parseTimecode(s, now, total);
  expect(at('83')).toBe(83);
  expect(at('1:23.5')).toBe(83.5);
  expect(at('1:02:03')).toBe(3723);
  expect(at('١:٢٠')).toBe(80);
  expect(at('٤٫٥')).toBe(4.5);
  expect(at('+5')).toBe(15);
  expect(at('-20')).toBe(0);
  expect(at('99', 0, 30)).toBe(30);
  for (const bad of ['', 'abc', '1:75', '1::2', '5s']) expect(at(bad)).toBeNull();
});
