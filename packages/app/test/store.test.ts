import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOps, Project } from '../../shared/src/index.ts';

vi.stubGlobal('window', { innerWidth: 1200 });
vi.stubGlobal('location', { href: 'http://localhost/?p=old', protocol: 'http:', host: 'localhost' });
vi.stubGlobal('history', { replaceState: vi.fn() });
vi.mock('../src/lib/api.ts', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }, projectPath: (name: string) => `/api/projects/${name}` }));
const { api } = await import('../src/lib/api.ts');
const { useStore, connectLive } = await import('../src/lib/store.ts');
const response = (name: string, rev = 1) => ({ project: Project.parse({ name, createdAt: '2026-01-01' }), rev, history: { undo: 0, redo: 0 } });
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => { useStore.getState().close(); useStore.setState({ projects: [], trash: [], projectsLoaded: false, projectsError: undefined }); vi.resetAllMocks(); });

it('allows the playhead to land on the exact final cut without extending the project', () => {
  const project = Project.parse({ name: 'seek', createdAt: '', clips: [{ id: 'end', trackId: 'T1', start: 0, in: 0, out: 10, text: 'end' }] });
  useStore.setState({ project, playRange: [1, 3] });
  useStore.getState().seek(10); expect(useStore.getState()).toMatchObject({ time: 10, playRange: undefined });
  useStore.getState().seek(100); expect(useStore.getState().time).toBe(10);
  useStore.getState().seek(-1); expect(useStore.getState().time).toBe(0);
  expect(api.post).not.toHaveBeenCalled();
});

describe('project isolation', () => {
  it('saves a repeated volume-key burst as one batch and leaves idle edits synchronous', async () => {
    vi.useFakeTimers();
    try {
      const project = Project.parse({ name: 'old', createdAt: '', tracks: [{ id: 'V1', kind: 'video', name: 'V1', magnetic: true }], media: [{ id: 'm', path: 'a.wav', name: 'a', kind: 'audio', role: 'source', hasAudio: true }], clips: [{ id: 'c', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 10 }] });
      useStore.setState({ name: 'old', project, selected: ['c'], rev: 0, history: { undo: 0, redo: 0 } });
      vi.mocked(api.post).mockImplementation(async (_, body: any) => ({ project: applyOps(project, body.ops), rev: 1, history: { undo: 1, redo: 0 } }));
      for (let i = 0; i < 3; i++) useStore.getState().adjustVolume(1);
      expect(api.post).not.toHaveBeenCalled();
      expect(useStore.getState().project?.clips[0].volume).toBeCloseTo(10 ** .15);
      await vi.advanceTimersByTimeAsync(301);
      await useStore.getState().flushVolume();
      expect(api.post).toHaveBeenCalledTimes(1);
      expect(useStore.getState().history.undo).toBe(1);
    } finally { vi.useRealTimers(); }
  });
  it('restores the last project if an edit and recovery request both fail', async () => {
    const initial = response('old');
    useStore.setState({ name: 'old', ...initial });
    vi.mocked(api.post).mockRejectedValue(new Error('offline'));
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    expect(await useStore.getState().ops([{ op: 'set_settings', patch: { aspect: '9:16' } }])).toBe(false);
    expect(useStore.getState().project).toBe(initial.project);
  });
  it('a slow older open cannot replace the newer project', async () => {
    const slow = deferred<ReturnType<typeof response>>();
    vi.mocked(api.get).mockImplementation(async (url) => url === '/api/projects/old' ? slow.promise : url.startsWith('/api/jobs') ? [] : response('new'));
    const first = useStore.getState().open('old');
    await useStore.getState().open('new');
    slow.resolve(response('old'));
    await first;
    expect(useStore.getState().name).toBe('new');
  });
  it('late edit replies cannot overwrite a different project', async () => {
    useStore.setState({ name: 'old', ...response('old') });
    const pending = deferred<ReturnType<typeof response>>();
    vi.mocked(api.post).mockReturnValue(pending.promise);
    const edit = useStore.getState().ops([{ op: 'set_settings', patch: { aspect: '9:16' } }]);
    vi.mocked(api.get).mockImplementation(async (url) => url.startsWith('/api/jobs') ? [] : response('new'));
    await useStore.getState().open('new');
    pending.resolve(response('old', 20));
    await edit;
    expect(useStore.getState().project?.name).toBe('new');
  });
  it('closing invalidates a pending project request and clears project-specific state', async () => {
    const pending = deferred<ReturnType<typeof response>>();
    vi.mocked(api.get).mockReturnValue(pending.promise);
    const open = useStore.getState().open('old');
    useStore.setState({ lastRender: { url: '/old.mp4', output: 'old' }, draftBase: response('old').project, playing: true });
    useStore.getState().close();
    pending.resolve(response('old'));
    await open;
    expect(useStore.getState()).toMatchObject({ name: undefined, project: undefined, lastRender: undefined, draftBase: undefined, playing: false });
  });
});

describe('durable checkpoints and captured exports', () => {
  const checkpoint = { id: 'checkpoint-1', label: 'قبل الألوان', createdAt: '2026-10-29T00:00:00Z', sourceRev: 1, kind: 'manual' as const };
  const safety = { ...checkpoint, id: 'safety-1', label: 'نقطة أمان', kind: 'before_restore' as const };
  const version = { rev: 1, snapshotId: 'snapshot-1', quality: 'final' as const, output: 'renders/final-r1.mp4' };
  const job = { id: 'render-1', project: 'old', kind: 'render', label: 'تصدير', status: 'queued' as const, progress: 0, createdAt: 1 };
  it('saving a named checkpoint does not change the edit or undo history', async () => {
    const initial = response('عنوان المشروع');
    useStore.setState({ name: 'old', ...initial });
    vi.mocked(api.post).mockResolvedValue({ checkpoint });
    expect(await useStore.getState().saveCheckpoint(' قبل الألوان ')).toEqual(checkpoint);
    expect(api.post).toHaveBeenCalledWith('/api/projects/old/checkpoints', { label: 'قبل الألوان' });
    expect(useStore.getState().project).toBe(initial.project);
    expect(useStore.getState().rev).toBe(1);
    expect(useStore.getState().history).toEqual(initial.history);
    expect(useStore.getState().checkpoints).toEqual([checkpoint]);
  });
  it('a delayed checkpoint list cannot erase a newly confirmed saved point', async () => {
    useStore.setState({ name: 'old', ...response('old') });
    const pending = deferred<typeof checkpoint[]>();
    vi.mocked(api.get).mockReturnValue(pending.promise);
    const loading = useStore.getState().loadCheckpoints();
    vi.mocked(api.post).mockResolvedValue({ checkpoint });
    await useStore.getState().saveCheckpoint(checkpoint.label);
    pending.resolve([]); await loading;
    expect(useStore.getState().checkpoints).toEqual([checkpoint]);
  });
  it('restores with the confirmed revision and keeps the returned automatic safety point', async () => {
    const initial = response('old');
    useStore.setState({ name: 'old', ...initial, selected: ['old-clip'], time: 8, playing: true, draftBase: initial.project });
    const restored = response('قصة مستعادة', 2);
    vi.mocked(api.post).mockResolvedValue({ ...restored, restoredCheckpointId: checkpoint.id, safetyCheckpoint: safety });
    expect(await useStore.getState().restoreCheckpoint(checkpoint.id, 1)).toEqual(safety);
    expect(api.post).toHaveBeenCalledWith('/api/projects/old/checkpoints/checkpoint-1/restore', { expectedRev: 1 });
    expect(useStore.getState()).toMatchObject({ name: 'old', project: restored.project, rev: 2, playing: false, time: 0, selected: [], draftBase: undefined, checkpoints: [safety] });
  });
  it('a rejected checkpoint restore preserves the current edit and checkpoints', async () => {
    const initial = response('old');
    useStore.setState({ name: 'old', ...initial, checkpoints: [checkpoint] });
    vi.mocked(api.post).mockRejectedValue(new Error('stale revision'));
    await expect(useStore.getState().restoreCheckpoint(checkpoint.id, 1)).rejects.toThrow('stale revision');
    expect(useStore.getState().project).toBe(initial.project);
    expect(useStore.getState().checkpoints).toEqual([checkpoint]);
  });
  it('external checkpoint restore overrides a local preview and invalidates older edit replies', async () => {
    let socket!: { onmessage?: (event: { data: string }) => void };
    class Socket { onmessage?: (event: { data: string }) => void; constructor() { socket = this; } close() {} }
    vi.stubGlobal('WebSocket', Socket);
    const initial = response('old');
    useStore.setState({ name: 'old', ...initial, projectsLoaded: true });
    const pending = deferred<ReturnType<typeof response>>();
    vi.mocked(api.post).mockReturnValue(pending.promise);
    vi.mocked(api.get).mockResolvedValue([safety]);
    const edit = useStore.getState().ops([{ op: 'set_settings', patch: { aspect: '9:16' } }]);
    useStore.setState({ draftBase: initial.project, playing: true, time: 90, selected: ['missing'], transcripts: { gone: null }, analysis: { gone: {} } });
    const restored = response('استعادة خارجية', 3);
    const dispose = connectLive();
    socket.onmessage?.({ data: JSON.stringify({ type: 'project', name: 'old', author: 'checkpoint', ...restored }) });
    pending.resolve(response('older response', 2)); await edit;
    expect(useStore.getState()).toMatchObject({ project: restored.project, rev: 3, draftBase: undefined, selected: [], time: 0, playing: false, transcripts: {}, analysis: {} });
    expect(api.get).toHaveBeenCalledWith('/api/projects/old/checkpoints');
    dispose();
  });
  it('retains safety metadata when the checkpoint WebSocket event arrives before the HTTP reply', async () => {
    let socket!: { onmessage?: (event: { data: string }) => void };
    class Socket { onmessage?: (event: { data: string }) => void; constructor() { socket = this; } close() {} }
    vi.stubGlobal('WebSocket', Socket);
    useStore.setState({ name: 'old', ...response('old'), projectsLoaded: true });
    const pending = deferred<any>();
    vi.mocked(api.post).mockReturnValue(pending.promise);
    vi.mocked(api.get).mockResolvedValue([checkpoint]);
    const restore = useStore.getState().restoreCheckpoint(checkpoint.id, 1);
    const restored = response('restored', 2);
    const dispose = connectLive();
    socket.onmessage?.({ data: JSON.stringify({ type: 'project', name: 'old', author: 'checkpoint', ...restored }) });
    await Promise.resolve();
    pending.resolve({ ...restored, safetyCheckpoint: safety }); await restore;
    expect(useStore.getState().project).toEqual(restored.project);
    expect(useStore.getState().checkpoints).toContainEqual(safety);
    dispose();
  });
  it('submits the checked export revision and preserves a newer live job status', async () => {
    useStore.setState({ name: 'old', ...response('old') });
    const pending = deferred<{ job: typeof job; render: typeof version }>();
    vi.mocked(api.post).mockReturnValue(pending.promise);
    const rendering = useStore.getState().startRender('final', 1);
    useStore.setState({ jobs: { [job.id]: { ...job, status: 'running', progress: .5, render: version } } });
    pending.resolve({ job, render: version });
    expect(await rendering).toEqual(version);
    expect(api.post).toHaveBeenCalledWith('/api/projects/old/render', { quality: 'final', expectedRev: 1 });
    expect(useStore.getState().jobs[job.id]).toMatchObject({ status: 'running', progress: .5, render: version });
  });
  it('refuses a locally stale export check and ignores a late reply after closing the project', async () => {
    useStore.setState({ name: 'old', ...response('old', 2) });
    await expect(useStore.getState().startRender('final', 1)).rejects.toThrow('تغيّر المشروع');
    expect(api.post).not.toHaveBeenCalled();
    const pending = deferred<{ job: typeof job; render: typeof version }>();
    vi.mocked(api.post).mockReturnValue(pending.promise);
    const rendering = useStore.getState().startRender('final', 2);
    useStore.getState().close();
    pending.resolve({ job, render: { ...version, rev: 2 } }); await rendering;
    expect(useStore.getState().jobs).toEqual({});
  });
});

describe('recoverable project management', () => {
  const row = { name: 'stable-folder', displayName: 'قصة قديمة', modified: 10, media: 0 };
  const trashed = { id: 'trash-id', name: row.name, displayName: row.displayName, deletedAt: '2026-10-29T00:00:00Z' };
  it('renames the display label without changing the project folder ID', async () => {
    useStore.setState({ projects: [row] });
    vi.mocked(api.patch).mockResolvedValue(response('اسم جديد'));
    vi.mocked(api.get).mockRejectedValue(new Error('list temporarily unavailable'));
    await useStore.getState().renameProject(row.name, ' اسم جديد ');
    expect(api.patch).toHaveBeenCalledWith('/api/projects/stable-folder', { name: 'اسم جديد' });
    expect(useStore.getState().projects[0]).toMatchObject({ name: row.name, displayName: 'اسم جديد' });
  });
  it('keeps a failed delete visible and removes it only after server confirmation', async () => {
    useStore.setState({ projects: [row] });
    vi.mocked(api.delete).mockRejectedValueOnce(new Error('project busy'));
    await expect(useStore.getState().deleteProject(row.name)).rejects.toThrow('project busy');
    expect(useStore.getState().projects).toEqual([row]);
    vi.mocked(api.delete).mockResolvedValue({ ok: true, trashed });
    expect(await useStore.getState().deleteProject(row.name)).toEqual(trashed);
    expect(useStore.getState().projects).toEqual([]);
    expect(useStore.getState().trash).toEqual([trashed]);
  });
  it('an older project-list response cannot resurrect a successfully deleted project', async () => {
    useStore.setState({ projects: [row] });
    const pending = deferred<typeof row[]>();
    vi.mocked(api.get).mockReturnValue(pending.promise);
    const loading = useStore.getState().loadProjects();
    vi.mocked(api.delete).mockResolvedValue({ ok: true, trashed });
    await useStore.getState().deleteProject(row.name);
    pending.resolve([row]); await loading;
    expect(useStore.getState().projects).toEqual([]);
  });
  it('preserves trash on restore conflict and restores using the returned folder ID', async () => {
    useStore.setState({ trash: [trashed] });
    vi.mocked(api.post).mockRejectedValueOnce(new Error('folder already exists'));
    await expect(useStore.getState().restoreProject(trashed.id)).rejects.toThrow('folder already exists');
    expect(useStore.getState().trash).toEqual([trashed]);
    vi.mocked(api.post).mockResolvedValue({ name: row.name, ...response('قصة قديمة') });
    vi.mocked(api.get).mockRejectedValue(new Error('list temporarily unavailable'));
    await useStore.getState().restoreProject(trashed.id);
    expect(api.post).toHaveBeenLastCalledWith('/api/projects/.trash/trash-id/restore');
    expect(useStore.getState().trash).toEqual([]);
    expect(useStore.getState().projects[0]).toMatchObject({ name: row.name, displayName: row.displayName });
  });
  it('an older trash response cannot reinsert a restored project', async () => {
    useStore.setState({ trash: [trashed] });
    const pending = deferred<typeof trashed[]>();
    vi.mocked(api.get).mockImplementation(async (url) => url.endsWith('/.trash') ? pending.promise : [row]);
    const loading = useStore.getState().loadTrash();
    vi.mocked(api.post).mockResolvedValue({ name: row.name, ...response(row.displayName) });
    await useStore.getState().restoreProject(trashed.id);
    pending.resolve([trashed]); await loading;
    expect(useStore.getState().trash).toEqual([]);
  });
  it('recovers failed edits when the display name differs from its folder', async () => {
    const initial = response('عنوان مختلف');
    useStore.setState({ name: row.name, ...initial });
    vi.mocked(api.post).mockRejectedValue(new Error('offline'));
    vi.mocked(api.get).mockResolvedValue(initial);
    expect(await useStore.getState().ops([{ op: 'set_settings', patch: { aspect: '9:16' } }])).toBe(false);
    expect(api.get).toHaveBeenCalledWith('/api/projects/stable-folder');
    expect(useStore.getState().project?.settings.aspect).toBe(initial.project.settings.aspect);
  });
  it('updates library metadata for a project changed outside the open editor', () => {
    let socket!: { onmessage?: (event: { data: string }) => void };
    class Socket { onmessage?: (event: { data: string }) => void; constructor() { socket = this; } close() {} }
    vi.stubGlobal('WebSocket', Socket);
    useStore.setState({ projects: [row], projectsLoaded: true });
    const dispose = connectLive();
    const changed = response('اسم ظاهر جديد');
    changed.project.media.push({ id: 'video', path: 'source/video.mp4', name: 'Video', role: 'source', kind: 'video', duration: 5, width: 1920, height: 1080, fps: 30, hasAudio: true, analyzed: [] });
    socket.onmessage?.({ data: JSON.stringify({ type: 'project', name: row.name, ...changed }) });
    expect(useStore.getState().projects[0]).toMatchObject({ name: row.name, displayName: 'اسم ظاهر جديد', media: 1 });
    expect(useStore.getState().project).toBeUndefined();
    dispose();
  });
  it('leaves a deleted open project when another client deletes it', async () => {
    let socket!: { onmessage?: (event: { data: string }) => void };
    class Socket { onmessage?: (event: { data: string }) => void; constructor() { socket = this; } close() {} }
    vi.stubGlobal('WebSocket', Socket);
    useStore.setState({ name: row.name, ...response(row.displayName), projects: [row] });
    vi.mocked(api.get).mockResolvedValue([]);
    const dispose = connectLive();
    socket.onmessage?.({ data: JSON.stringify({ type: 'project_deleted', name: row.name }) });
    expect(useStore.getState().project).toBeUndefined();
    expect(useStore.getState().projects).toEqual([]);
    await Promise.resolve();
    dispose();
  });
});

it('disposing a live connection cancels scheduled reconnection', () => {
  vi.useFakeTimers();
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    onclose?: () => void;
    constructor() { sockets.push(this); }
    close() { this.onclose?.(); }
  }
  vi.stubGlobal('WebSocket', FakeSocket);
  const dispose = connectLive();
  sockets[0].onclose?.();
  dispose();
  vi.advanceTimersByTime(10000);
  expect(sockets).toHaveLength(1);
  vi.useRealTimers();
});

it('reconnect accepts the server revision after a restart and keeps subsequent live edits', async () => {
  let socket!: { onopen?: () => void; onmessage?: (event: { data: string }) => void };
  class Socket {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor() { socket = this; }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  useStore.setState({ name: 'old', ...response('old', 40) });
  const restarted = response('old', 0);
  vi.mocked(api.get).mockImplementation(async (url) => url === '/api/projects/old' ? restarted : []);
  const dispose = connectLive();
  socket.onopen?.();
  await Promise.resolve(); await Promise.resolve();
  expect(useStore.getState().rev).toBe(0);
  socket.onmessage?.({ data: JSON.stringify({ type: 'project', name: 'old', ...response('old', 1) }) });
  expect(useStore.getState().rev).toBe(1);
  dispose();
});

it('a delayed reconnect refresh cannot replace a newer live project', async () => {
  let socket!: { onopen?: () => void; onmessage?: (event: { data: string }) => void };
  class Socket {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor() { socket = this; }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  useStore.setState({ name: 'old', ...response('old', 40) });
  const pending = deferred<ReturnType<typeof response>>();
  vi.mocked(api.get).mockImplementation(async (url) => url === '/api/projects/old' ? pending.promise : []);
  const dispose = connectLive();
  socket.onopen?.();
  socket.onmessage?.({ data: JSON.stringify({ type: 'project', name: 'old', ...response('old', 1) }) });
  pending.resolve(response('old', 0));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(useStore.getState().rev).toBe(1);
  dispose();
});

it('old in-flight edits cannot overwrite the restarted server revision epoch', async () => {
  let socket!: { onopen?: () => void };
  class Socket {
    onopen?: () => void;
    constructor() { socket = this; }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  useStore.setState({ name: 'old', ...response('old', 40) });
  const pendingEdit = deferred<ReturnType<typeof response>>();
  vi.mocked(api.post).mockReturnValue(pendingEdit.promise);
  const edit = useStore.getState().ops([{ op: 'set_settings', patch: { aspect: '9:16' } }]);
  vi.mocked(api.get).mockImplementation(async (url) => url === '/api/projects/old' ? response('old', 0) : []);
  const dispose = connectLive();
  socket.onopen?.();
  await Promise.resolve(); await Promise.resolve();
  pendingEdit.resolve(response('old', 41));
  await edit;
  expect(useStore.getState().rev).toBe(0);
  dispose();
});
