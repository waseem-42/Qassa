import { describe, expect, it } from 'vitest';
import { applyOps, Project } from '../src/index.ts';

describe('style use history', () => {
  it('migrates old projects and records one entry per id without mutating the snapshot', () => {
    const p = Project.parse({ name: 'test', createdAt: '2026-10-30' });
    expect(p.stylesUsed).toEqual([]);
    const first = applyOps(p, [{ op: 'log_style', id: 'test', name: 'Style', source: 'library', by: 'claude', what: 'مرجع المقدمة', at: '2026-10-29T12:00:00Z' }]);
    const next = applyOps(first, [{ op: 'log_style', id: 'test', name: 'Style', source: 'library', by: 'user', what: 'مرجع النهاية', at: '2026-10-30T12:00:00Z' }]);
    expect(p.stylesUsed).toEqual([]); expect(first.stylesUsed[0].what).toBe('مرجع المقدمة');
    expect(next.stylesUsed).toHaveLength(1); expect(next.stylesUsed[0]).toMatchObject({ what: 'مرجع النهاية', by: 'user', at: '2026-10-30T12:00:00Z' });
  });
});
