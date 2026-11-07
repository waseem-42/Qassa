import { describe, expect, it } from 'vitest';
import { applyOps, defaultTracks, Op, Project } from '../src/index.ts';

const project = () => Project.parse({
  name: 'film', createdAt: '2026-01-01', tracks: defaultTracks(),
  media: [{ id: 'm', path: 'source/original.mp4', name: 'original', role: 'source', kind: 'video', duration: 60 }],
  clips: [{ id: 'c', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 60 }],
});
const restoreContext = { allowProjectRestore: true };

describe('restore_project operation', () => {
  it('restores the full saved state without mutating either snapshot or live project', () => {
    const original = project();
    const edited = applyOps(original, [{ op: 'cut_range', mediaId: 'm', t0: 10, t1: 30 }, { op: 'rename_project', name: 'Edited' }]);
    const before = structuredClone(edited);
    const restored = applyOps(edited, [{ op: 'restore_project', project: original }], restoreContext);
    expect(restored).toEqual(original);
    expect(edited).toEqual(before);
    restored.media[0].path = 'changed';
    expect(original.media[0].path).toBe('source/original.mp4');
  });

  it('preserves the complete saved timing instead of silently normalizing it', () => {
    const saved = project();
    saved.clips[0].start = 2;
    expect(applyOps(project(), [{ op: 'restore_project', project: saved }], restoreContext)).toEqual(saved);
  });

  it('rejects a different project identity or remapped existing media source', () => {
    const wrongIdentity = { ...project(), createdAt: 'other-project' };
    expect(() => applyOps(project(), [{ op: 'restore_project', project: wrongIdentity }], restoreContext)).toThrow('identity');
    const remapped = project();
    remapped.media[0].path = 'source/replacement.mp4';
    expect(() => applyOps(project(), [{ op: 'restore_project', project: remapped }], restoreContext)).toThrow('source path');
  });

  it('validates snapshots at both schema and execution boundaries', () => {
    const invalid = { ...project(), clips: 'invalid' } as unknown as Project;
    const op = { op: 'restore_project' as const, project: invalid };
    expect(Op.safeParse(op).success).toBe(false);
    expect(() => applyOps(project(), [op], restoreContext)).toThrow();
  });

  it('supports subsequent edits against the restored state and retains source identifiers', () => {
    const restored = applyOps(project(), [{ op: 'restore_project', project: project() }, { op: 'cut_range', mediaId: 'm', t0: 0, t1: 5 }], restoreContext);
    expect(restored.clips[0]).toMatchObject({ id: 'c', mediaId: 'm', start: 0, in: 5, out: 60 });
    expect(restored.media[0]).toEqual(project().media[0]);
  });

  it('rejects full-project replacement through an ordinary edit batch', () => {
    expect(() => applyOps(project(), [{ op: 'restore_project', project: project() }])).toThrow('checkpoint restore API');
  });

  it('rejects duplicate source IDs, broken references, and nonpositive clip durations', () => {
    const duplicate = project(); duplicate.media.push({ ...duplicate.media[0] });
    const missingMedia = project(); missingMedia.clips[0].mediaId = 'missing';
    const missingTrack = project(); missingTrack.clips[0].trackId = 'missing';
    const duration = project(); duration.clips[0].out = duration.clips[0].in;
    for (const snapshot of [duplicate, missingMedia, missingTrack, duration]) {
      expect(() => applyOps(project(), [{ op: 'restore_project', project: snapshot }], restoreContext)).toThrow('restore_project:');
    }
  });
});
