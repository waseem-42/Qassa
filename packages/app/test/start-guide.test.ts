import { afterEach, expect, it, vi } from 'vitest';
import { Project, type Op } from '@edit/shared';
import { guideEdit, guideExported, guideProgress, guideProjectKey, useStartGuide } from '../src/lib/start-guide.ts';

afterEach(() => { vi.unstubAllGlobals(); useStartGuide.setState({ dismissed: false, edited: [] }); });

it('checks actual media, placed clips, editing and completed exports separately', () => {
  const p = Project.parse({ name: 'guide', createdAt: '2026-11-08' });
  expect(guideProgress(p, false, false)).toEqual([false, false, false, false]);
  p.media = [{ id: 'm', name: 'v', path: 'v.mp4', kind: 'video', role: 'source', duration: 3 } as Project['media'][number]];
  expect(guideProgress(p, false, false)).toEqual([true, false, false, false]);
  p.clips = [{ id: 'c', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 3, speed: 1, volume: 1 }];
  expect(guideProgress(p, false, false)).toEqual([true, true, false, false]);
  expect(guideProgress(p, true, true)).toEqual([true, true, true, true]);
  expect(guideProjectKey({ ...p, name: 'renamed' })).toBe(guideProjectKey(p));
  expect(guideProjectKey({ ...p, createdAt: '2026-11-09' })).not.toBe(guideProjectKey(p));
});

it('placement, comments, marks and setup do not count as the first edit; cuts and new titles do', () => {
  const placement: Op[] = [{ op: 'add_clip', clip: { mediaId: 'm', trackId: 'V1', in: 0, out: 3 } }, { op: 'set_marks', in: 0, out: 2 }, { op: 'add_track', track: { id: 'T', kind: 'text', name: 'نص' } }];
  expect(guideEdit(placement)).toBe(false);
  expect(guideEdit([{ op: 'resolve_suggestions', ids: 'all', accept: false }])).toBe(false);
  expect(guideEdit([{ op: 'split', clipId: 'v', at: 1 }])).toBe(true);
  expect(guideEdit([{ op: 'add_clip', clip: { id: 't', trackId: 'T', text: 'عنوان', in: 0, out: 3 } }])).toBe(true);
  expect(guideEdit([{ op: 'add_text', text: 'عنوان', start: 0, duration: 3 }])).toBe(true);
});

it('ignores unfinished exports and exports from a deleted project with the same name', () => {
  const p = Project.parse({ name: 'guide', createdAt: '2026-11-08T00:00:00Z' });
  const at = Date.parse(p.createdAt);
  expect(guideExported(p, [{ kind: 'render', status: 'done', createdAt: at - 1 }, { kind: 'render', status: 'running', createdAt: at + 1 }, { kind: 'analyze', status: 'done', createdAt: at + 1 }])).toBe(false);
  expect(guideExported(p, [{ kind: 'render', status: 'done', createdAt: at + 1 }])).toBe(true);
});

it('remembers dismissal/reopen and edit milestones, and tolerates unavailable storage', () => {
  const setItem = vi.fn(); vi.stubGlobal('localStorage', { setItem });
  const p = Project.parse({ name: 'guide', createdAt: '2026-11-08' });
  useStartGuide.getState().close(); expect(useStartGuide.getState().dismissed).toBe(true);
  expect(JSON.parse(setItem.mock.calls.at(-1)![1]).dismissed).toBe(true);
  useStartGuide.getState().show(); expect(useStartGuide.getState().dismissed).toBe(false);
  useStartGuide.getState().record(p, [{ op: 'split', clipId: 'v', at: 1 }]);
  expect(useStartGuide.getState().edited).toEqual([guideProjectKey(p)]);
  vi.stubGlobal('localStorage', { setItem() { throw Error('unavailable'); } });
  expect(() => useStartGuide.getState().close()).not.toThrow();
  expect(() => useStartGuide.getState().show()).not.toThrow();
});
