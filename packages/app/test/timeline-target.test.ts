import { it, expect } from 'vitest';
import { rowAtY } from '../src/lib/timeline-target.ts';
it('resolves rows by geometry through a spanning playhead, including boundaries', () => {
  const rows = [{ id: 'V1', top: 100, bottom: 150 }, { id: 'V2', top: 150, bottom: 200 }];
  expect(rowAtY(rows, 125)?.id).toBe('V1'); expect(rowAtY(rows, 150)?.id).toBe('V2');
  expect(rowAtY(rows, 99)).toBeUndefined(); expect(rowAtY(rows, 200)).toBeUndefined();
});
