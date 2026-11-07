import { describe, expect, it } from 'vitest';
import { applyOps, Op, Project } from '../src/index.ts';

describe('project display name', () => {
  it('renames an immutable snapshot, preserving media paths and creation time', () => {
    const p = Project.parse({ name: 'folder-id', createdAt: '2026-01-01', media: [{ id: 'm', path: 'source/original.mp4', name: 'original', role: 'source', kind: 'video' }] });
    const next = applyOps(p, [{ op: 'rename_project', name: '  مشروع: الحلقة / ٢  ' }]);
    expect(next).toEqual({ ...p, name: 'مشروع: الحلقة / ٢' });
    expect(p.name).toBe('folder-id');
  });

  it.each(['', '   ', 'a'.repeat(121), 'a\nb', 'a\u0000b', 'a\u0085b'])('rejects invalid display name %j both at schema and apply boundaries', (name) => {
    const op = { op: 'rename_project' as const, name };
    expect(Op.safeParse(op).success).toBe(false);
    expect(() => applyOps(Project.parse({ name: 'original', createdAt: '2026-01-01' }), [op])).toThrow();
  });
});
