import { expect, it } from 'vitest';
import { changedValue } from '../src/lib/inspector.ts';

it('marks effective nested changes and keys without treating missing/default values as changed', () => {
  const defaults = { x: 0.5, crop: { l: 0 }, keys: [] };
  expect(changedValue(undefined, defaults)).toBe(false);
  expect(changedValue({ x: 0.5, crop: { l: 0 }, keys: [] }, defaults)).toBe(false);
  expect(changedValue({ crop: { l: 0.1 } }, defaults)).toBe(true);
  expect(changedValue({ keys: [{ t: 0, value: 1 }] }, defaults)).toBe(true);
});
