import { expect, it } from 'vitest';
import { projectState } from '../src/project-state.ts';

it('makes truncation explicit, supports paging/exact clips and keeps full state opt-in', () => {
  const r = { rev: 4, history: { undo: 3 }, project: { clips: Array.from({ length: 150 }, (_, i) => ({ id: String(i), graphicData: { title: 'عنوان' } })) } };
  expect(projectState(r).project.clips).toHaveLength(40);
  expect(projectState(r).clipWindow).toMatchObject({ total: 150, truncated: true, next: 40 });
  expect(projectState(r, { from: 140 }).project.clips).toHaveLength(10);
  expect(projectState(r, { clipIds: ['120'] }).project.clips).toEqual([r.project.clips[120]]);
  expect(projectState(r, { full: true })).toBe(r);
});
