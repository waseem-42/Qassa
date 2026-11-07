import { expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { captionOps, Media, TRANSCRIBE_STEPS } from '@edit/shared';
import { Store } from '../src/store.ts';
import { Jobs, runPython } from '../src/jobs.ts';
import { queueAnalysis, stepsFor } from '../src/media.ts';

vi.mock('../src/jobs.ts', async (original) => ({ ...await original<typeof import('../src/jobs.ts')>(), runPython: vi.fn(async (_python, args: string[]) => {
  const steps = args[args.indexOf('--steps') + 1].split(',');
  if (steps.includes('transcribe')) {
    const id = args[args.indexOf('--media-id') + 1], dir = join(args[args.indexOf('--project') + 1], 'analysis', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'transcript.json'), JSON.stringify({ mediaId: id, language: 'ar', model: 'test', words: [{ i: 0, t0: .1, t1: .6, w: 'مرحبا' }], segments: [{ t0: .1, t1: .6, w0: 0, w1: 0 }] }));
  }
  return { analyzed: steps };
}) }));

it('upload preparation never requests Whisper for any role; explicit transcription is deduplicated and unlocks captions on A2', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qassa-transcribe-')), store = new Store(root, { watch: false }), jobs = new Jobs();
  try {
    store.create('qa');
    const m = Media.parse({ id: 'a', name: 'كلام', path: 'source/a.wav', kind: 'audio', role: 'source', hasAudio: true, duration: 1 });
    for (const role of ['source', 'ref', 'broll', 'music', 'sfx', 'graphic'] as const) for (const kind of ['video', 'audio'] as const) expect(stepsFor({ ...m, role, kind })).not.toContain('transcribe');
    expect(stepsFor(m)).toContain('silence');
    store.mutate('qa', (p) => p.media.push(m));
    store.apply('qa', [{ op: 'add_clip', clip: { trackId: 'A2', mediaId: m.id, start: 2, in: 0, out: 1 } }, { op: 'add_text', text: 'keep', start: 0, duration: 1 }]);
    const prep = queueAnalysis(store, jobs, 'qa', m.id); await jobs.wait(prep.id, 2000);
    expect(prep.steps).not.toContain('transcribe'); expect(store.transcript('qa', m.id)).toBeUndefined();
    expect(() => captionOps(store.get('qa').project, (id) => store.transcript('qa', id))).toThrow('يحتاج تفريغ');
    expect(store.get('qa').project.clips.some((c) => c.text === 'keep')).toBe(true);
    const job = queueAnalysis(store, jobs, 'qa', m.id, TRANSCRIBE_STEPS, { reason: 'assistant' });
    expect(queueAnalysis(store, jobs, 'qa', m.id, TRANSCRIBE_STEPS).id).toBe(job.id);
    await jobs.wait(job.id, 2000);
    expect(job.message).toBe('المساعد يحتاج التفريغ — يبدأ الآن');
    expect(vi.mocked(runPython).mock.calls.at(-1)?.[1]).toContain('transcribe,silence,summary');
    const ops = captionOps(store.get('qa').project, (id) => store.transcript('qa', id));
    expect(ops).toContainEqual(expect.objectContaining({ op: 'add_text', text: 'مرحبا', start: 2.1 }));
  } finally {
    await store.close();
    if (!relative(tmpdir(), root).startsWith('qassa-transcribe-')) throw new Error('unsafe cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});
