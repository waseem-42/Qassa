import { expect, it } from 'vitest';
import { Clip } from '@edit/shared';
import { bandHits, bandSelection } from '../src/lib/selection.ts';
import { actionFor, comboOf } from '../src/lib/keys.ts';

it('a band touches only intersecting clips on crossed tracks; Shift adds and Ctrl toggles from the drag baseline', () => {
  const clips = [Clip.parse({ id: 'a', trackId: 'V1', start: 2, in: 0, out: 3 }), Clip.parse({ id: 'b', trackId: 'A', start: 4, in: 10, out: 12, speed: 2 }), Clip.parse({ id: 'c', trackId: 'T', start: 3, in: 0, out: 1 })];
  const rows = [{ id: 'V1', top: 26, bottom: 98 }, { id: 'A', top: 98, bottom: 142 }, { id: 'T', top: 142, bottom: 176 }];
  const hits = bandHits(clips, rows, { from: 3, to: 4.5, top: 40, bottom: 130 });
  expect(hits).toEqual(['a', 'b']);
  expect(bandSelection(['c'], hits, 'replace')).toEqual(['a', 'b']);
  expect(bandSelection(['c'], hits, 'add')).toEqual(['c', 'a', 'b']);
  expect(bandSelection(['a', 'c'], hits, 'toggle')).toEqual(['c', 'b']);
});

it('physical Arabic-layout I/O and Shift+Space map to rebindable mark actions', () => {
  const key = (code: string, value: string, shiftKey = false) => comboOf({ code, key: value, shiftKey, altKey: false, ctrlKey: false, metaKey: false } as KeyboardEvent);
  expect(actionFor(key('KeyI', 'ه'))).toBe('markIn');
  expect(actionFor(key('KeyO', 'خ'))).toBe('markOut');
  expect(actionFor(key('Space', ' ', true))).toBe('playMarked');
});
