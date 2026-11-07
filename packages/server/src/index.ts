import { appendFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import { ZodError } from 'zod';
import {
  captionOps, clipDuration, clipsAt, cutPoints, fmtTime, GRAPHIC_RUNTIME, graphicEntry, AUTO_MARK, mainClips, mainDuration, Media, newOverlapWarnings, OpBatch, OpError, SFX, SFX_TRACK, sfxPlan, type Op, type SfxId, outputSize, projectDuration, routeNotes, STYLE_PRESETS, styleOps, timelineToSource, wordStates, type Note, type Project,
} from '@edit/shared';
import { compile, denoiseFilters, fileKey, hasNvenc, runPlan } from '@edit/render';
import { createHash } from 'node:crypto';
import { ANALYSIS_DIR, APP_DIST, DATA_DIR, DESKTOP, GRAPHICS_LIB_DIR, PORT, PROJECTS_DIR, PYTHON } from './config.ts';
import { analysisReady, registerRuntime } from './runtime-setup.ts';
import { Store, projectDir, type ChangeEvent } from './store.ts';
import { registerRecentStyles } from './recent-styles.ts';
import { registerBrands } from './brands.ts';
import { PeakCache } from './peaks.ts';
import { registerProjectManagement } from './project-management.ts';
import { registerCheckpoints } from './checkpoints.ts';
import { Jobs, runPython, type Job } from './jobs.ts';
import { addMedia, queueAnalysis, readAnalysis } from './media.ts';
import { registerUploads } from './uploads.ts';
import { ensureImageProxies } from './image-proxy.ts';
import { registerAudioTracks } from './audio-tracks.ts';
import { ProjectStart, speechClips } from '@edit/shared';
import { fontFaceCss, fontFiles, renderTextImages } from './textimg.ts';
import { graphicStills, renderGraphics } from './graphics.ts';
import { deleteStyle, resolveStyle, saveStyle, savedStyles } from './styles.ts';
import { searchStyleCatalog, styleCatalog } from './style-library.ts';
import { favorites, setFavorite } from './favorites.ts';
import { sfxFile, sfxList } from './sfx.ts';
import { bakedLut, blankImage } from './luts.ts';
import { contactSheet, cutFrames, cutReport, evenTimes, ffmpeg, frameImage, tileImages } from './sheets.ts';
import { registerExportRoutes } from './export-preflight.ts';
import { registerClipTools } from './clip-tools.ts';
import { projectCover, STRIP_FRAMES } from './covers.ts';
import { routeTask, runAgent, setAgentProjectDir, taskLog, type AgentRequest } from './agent.ts';
import { recordCacheUse, registerRenderCache } from './render-cache.ts';

const store = new Store();
// journals in every mode: a restart (the dev server reloads on every source change) marks the jobs it cut short as
// failed instead of losing them — an AI task on a comment used to vanish without a word
const jobs = new Jobs(join(DATA_DIR, 'logs/jobs.json'));
// AI tasks queue on their own: one may start a render or an analysis through MCP and wait for it
const agentJobs = new Jobs(join(DATA_DIR, 'logs/agent-jobs.json'));
setAgentProjectDir(projectDir);
const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 20 * 1024 * 1024 });

await app.register(fastifyWebsocket);
await app.register(fastifyMultipart, { defCharset: 'utf8', limits: { fileSize: 64 * 1024 * 1024 * 1024 } });
// no-cache: the browser asks again every time (a cheap 304 when unchanged) — project files are rewritten in place
// (graphic pages, proxies, a re-mixed recording) and a heuristically cached copy showed the old one
const revalidate = (res: { setHeader(k: string, v: string): unknown }) => res.setHeader('Cache-Control', 'no-cache');
await app.register(fastifyStatic, { root: PROJECTS_DIR, prefix: '/files/', decorateReply: false, cacheControl: false, setHeaders: revalidate, dotfiles: 'deny' });
if (!DESKTOP) mkdirSync(GRAPHICS_LIB_DIR, { recursive: true });
await app.register(fastifyStatic, { root: GRAPHICS_LIB_DIR, prefix: '/graphics-lib/', decorateReply: false, cacheControl: false, setHeaders: revalidate });
if (existsSync(APP_DIST)) await app.register(fastifyStatic, { root: APP_DIST, prefix: '/', decorateReply: false, wildcard: false });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof OpError) return reply.code(400).send({ error: err.message });
  if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid input', issues: err.issues.slice(0, 8) });
  reply.code((err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message });
});

// ---------------------------------------------------------------- live updates

const sockets = new Set<{ send: (s: string) => void; readyState: number }>();
const broadcast = (msg: unknown) => {
  const s = JSON.stringify(msg);
  for (const ws of sockets) if (ws.readyState === 1) ws.send(s);
};
store.on('change', (e: ChangeEvent) => broadcast({ type: 'project', name: e.name, project: e.project, rev: e.rev, author: e.author, history: store.history(e.name) }));
const peakCache = new PeakCache(store, (name, mediaId) => broadcast({ type: 'analysis', name, mediaId }));
store.on('warning', (message: string) => broadcast({ type: 'warning', message }));
store.on('projects', () => broadcast({ type: 'projects' }));
store.on('deleted', (name: string) => broadcast({ type: 'project_deleted', name }));
jobs.on('job', (job: Job) => broadcast({ type: 'job', job }));
agentJobs.on('job', (job: Job) => broadcast({ type: 'job', job }));

app.get('/ws', { websocket: true }, (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

// ---------------------------------------------------------------- projects

type P = { Params: { name: string } };

const view = (name: string) => {
  ensureImageProxies(store, name);
  const e = store.get(name);
  return { project: e.project, rev: e.rev, history: store.history(name) };
};

registerProjectManagement(app, store, jobs);
registerCheckpoints(app, store, jobs);
registerClipTools(app, store, jobs);
registerBrands(app, store, agentJobs);
registerRecentStyles(app, store);
registerRuntime(app);
registerRenderCache(app, store, [jobs, agentJobs]);

app.get('/api/health', async () => ({ ok: true, app: 'qassa', pid: process.pid, dataDir: DATA_DIR, nvenc: hasNvenc(), python: PYTHON, analysisReady: analysisReady() }));
app.get('/api/projects', async () => store.list());
app.post<{ Body: { name: string; start?: ProjectStart } }>('/api/projects', async (req) => {
  store.create(String(req.body?.name ?? '').trim(), ProjectStart.parse(req.body?.start ?? 'video'));
  return view(req.body.name.trim());
});
app.get<P>('/api/projects/:name', async (req) => view(req.params.name));

app.post<P & { Body: { ops: unknown; author?: string } }>('/api/projects/:name/ops', async (req) => {
  const ops = OpBatch.parse(req.body?.ops);
  const author = req.body?.author ?? 'user';
  const previous = store.get(req.params.name).project;
  const before = new Set(previous.notes.map((n) => n.id));
  const r = store.apply(req.params.name, ops, author);
  if (author === 'user' && r.project.settings.aiNotes) autoNotes(req.params.name, r.project.notes.filter((n) => !before.has(n.id) && n.author === 'user'));
  return { rev: r.rev, history: store.history(req.params.name), project: r.project, notices: r.notices, overlaps: newOverlapWarnings(previous, r.project) };
});
app.post<P & { Body: { maxWords?: number; style?: Record<string, unknown>; author?: string } }>('/api/projects/:name/captions', async (req) => {
  const name = req.params.name;
  const p = store.get(name).project;
  const ops = captionOps(p, (m) => store.transcript(name, m), { maxWords: req.body?.maxWords, style: req.body?.style as never });
  const r = store.apply(name, ops, req.body?.author ?? 'user');
  return { count: ops.length - 2, rev: r.rev, history: store.history(name), project: r.project };
});
app.post<P>('/api/projects/:name/undo', async (req) => ({ ok: store.undo(req.params.name), ...view(req.params.name) }));
app.post<P>('/api/projects/:name/redo', async (req) => ({ ok: store.redo(req.params.name), ...view(req.params.name) }));

app.post<P & { Body: { who?: string; text: string } }>('/api/projects/:name/changes', async (req) => {
  const line = `| ${new Date().toISOString().slice(0, 16).replace('T', ' ')} | ${req.body.who ?? 'claude'} | ${String(req.body.text).replace(/\n/g, ' ')} |\n`;
  appendFileSync(join(projectDir(req.params.name), 'CHANGES.md'), line, 'utf8');
  return { ok: true };
});

// ---------------------------------------------------------------- media

registerUploads(app, store, jobs);
registerAudioTracks(app, store, jobs);

app.post<P & { Body: { path: string; role?: Media['role']; copy?: boolean; analyze?: boolean } }>('/api/projects/:name/import', async (req) => {
  const role = Media.shape.role.parse(req.body.role ?? 'source');
  const media = addMedia(store, jobs, req.params.name, req.body.path, role, { copy: req.body.copy, analyze: req.body.analyze });
  const job = jobs.list(req.params.name).find((j) => j.kind === 'analyze' && j.mediaId === media.id && ['queued', 'running'].includes(j.status));
  return { media, job: job ?? null };
});

app.post<P & { Body: { mediaId: string; steps?: string[]; prompt?: string; model?: string; reason?: 'assistant' } }>('/api/projects/:name/analyze', async (req) => {
  return { job: queueAnalysis(store, jobs, req.params.name, req.body.mediaId, req.body.steps, { prompt: req.body.prompt, model: req.body.model, reason: req.body.reason }) };
});

app.get<P & { Params: { mediaId: string } }>('/api/projects/:name/media/:mediaId/transcript', async (req, reply) => {
  const t = store.transcript(req.params.name, req.params.mediaId);
  if (!t) return reply.code(404).send({ error: 'no transcript yet' });
  return t;
});

// ---------------------------------------------------------------- views for Claude

function overview(name: string, p: Project): string {
  const media = new Map(p.media.map((m) => [m.id, m]));
  const { width, height } = outputSize(p.settings);
  const lines = [
    `# ${p.name} — edit ${fmtTime(mainDuration(p))} (total ${fmtTime(projectDuration(p))}) · ${width}x${height} ${p.settings.aspect} @${p.settings.fps}fps`,
    `Marks (timeline seconds, fixed): In=${p.settings.marks.in ?? 'unset'} Out=${p.settings.marks.out ?? 'unset'}. For «صدّر المحدد», render with marked:true.`,
    '',
    '## Media',
    ...p.media.map((m) => `- ${m.id} [${m.role}/${m.kind}] ${m.name} ${fmtTime(m.duration)} ${m.width}x${m.height} analyzed=${m.analyzed.join(',') || 'no'}`),
    '',
    '## Main track (V1), in play order',
  ];
  mainClips(p).forEach((c, i) => {
    const g = c.grade ? ` grade=${JSON.stringify(c.grade)}` : '';
    const t = c.transform ? ` zoom=${c.transform.scale}${c.transform.keyframes.length ? `+${c.transform.keyframes.length}kf` : ''}` : '';
    if (c.gap) return void lines.push(`${i}. ${c.id} @${fmtTime(c.start)}–${fmtTime(c.start + clipDuration(c))}  gap (black, silent)`);
    lines.push(`${i}. ${c.id} @${fmtTime(c.start)}–${fmtTime(c.start + clipDuration(c))}  src ${media.get(c.mediaId!)?.name ?? c.mediaId} ${fmtTime(c.in)}–${fmtTime(c.out)}${c.speed !== 1 ? ` x${c.speed}` : ''}${g}${t}${c.label ? ` «${c.label}»` : ''}${c.transition ? ` ⧖${c.transition.kind} ${c.transition.duration}s` : ''}`);
  });
  const free = p.clips.filter((c) => c.trackId !== 'V1').sort((a, b) => a.start - b.start);
  if (free.length) {
    lines.push('', '## Other tracks');
    for (const c of free) lines.push(`- ${c.id} [${c.trackId}] @${fmtTime(c.start)}–${fmtTime(c.start + clipDuration(c))} ${c.text ? `text «${c.text}» ${c.textStyle?.preset ?? ''}` : c.graphic ? `graphic ${graphicEntry(c.graphic)}${c.in ? ` from ${c.in}s` : ''}${c.graphicData ? ` data=${JSON.stringify(c.graphicData).slice(0, 160)}` : ''}${c.place ? ` place=${JSON.stringify(c.place)}` : ''}` : media.get(c.mediaId!)?.name ?? ''}`);
  }
  if (p.settings.defaultGrade) lines.push('', `Default grade: ${JSON.stringify(p.settings.defaultGrade)}`);
  if (p.style) lines.push(`Active style: ${p.style}`);
  if (p.suggestions.length) {
    lines.push('', `## Pending suggestions (${p.suggestions.length}) — resolve_suggestions to accept/reject`);
    for (const s of p.suggestions.slice(0, 80)) lines.push(`- ${s.id} ${s.reason} ${s.mediaId} ${fmtTime(s.t0)}–${fmtTime(s.t1)} ${s.note ?? ''}`);
    if (p.suggestions.length > 80) lines.push(`… ${p.suggestions.length - 80} more`);
  }
  if (p.ideas.length) {
    lines.push('', `## Visual ideas waiting for the user (${p.ideas.length}) — resolve_ideas to add/dismiss`);
    for (const x of p.ideas) lines.push(`- ${x.id} ${x.kind} ${x.mediaId} ${fmtTime(x.t0)}–${fmtTime(x.t1)} ${x.graphic ?? x.text ?? x.source?.mediaId ?? x.search ?? ''} — ${x.note}`);
  }
  const open = p.notes.filter((n) => n.status === 'open');
  if (open.length) {
    lines.push('', `## Open comments from the user (${open.length}) — call notes for context, act, then update_note {status:'done', reply}`);
    for (const n of open) lines.push(`- ${n.id} @${fmtTime(n.at)}${n.end !== undefined ? `–${fmtTime(n.end)}` : ''}: ${n.text}`);
  }
  lines.push('', `Cuts on main track: ${cutPoints(p).length}`);
  return lines.join('\n');
}

app.get<P & { Querystring: { media?: string } }>('/api/projects/:name/summary', async (req, reply) => {
  const p = store.get(req.params.name).project;
  const parts = [overview(req.params.name, p)];
  for (const m of p.media) {
    if (req.query.media && req.query.media !== m.id) continue;
    const f = join(projectDir(req.params.name), 'analysis', m.id, 'summary.md');
    if (existsSync(f)) parts.push(readFileSync(f, 'utf8'));
  }
  reply.type('text/markdown; charset=utf-8');
  return parts.join('\n\n---\n\n');
});

/** What a comment points at: the words said there (source + timeline time) and what is on screen. */
function noteContext(name: string, p: Project, n: Note) {
  const t0 = n.at, t1 = n.end ?? n.at;
  const words: string[] = [];
  const main = timelineToSource(p, t0);
  const speaking = speechClips(p).filter((c) => c.start <= t0 && c.start + clipDuration(c) > t0);
  const free = speaking.find((c) => c.id === main?.clip.id) ?? speaking[0];
  const hit = free ? { clip: free, src: free.in + (t0 - free.start) * free.speed } : main;
  const tr = hit?.clip.mediaId ? store.transcript(name, hit.clip.mediaId) : undefined;
  if (hit && tr) {
    const states = hit.clip.trackId === 'V1' ? wordStates(p, hit.clip.mediaId!, tr.words) : undefined;
    const end = Math.min(hit.clip.out, hit.clip.in + (Math.max(t0, t1 - .01) - hit.clip.start) * hit.clip.speed);
    const s0 = hit.src - (n.end === undefined ? 3 : .5), s1 = end + (n.end === undefined ? 3 : .5);
    for (const w of tr.words) if (w.t1 > s0 && w.t0 < s1 && states?.[w.i] !== 'cut') words.push(`${w.i}:${w.w}@${w.t0.toFixed(2)}`);
  }
  const onScreen = p.tracks.flatMap((track) => clipsAt(p, t0, track.id).map((c) => {
    const m = p.media.find((x) => x.id === c.mediaId);
    const what = c.text ? `text «${c.text}»` : c.graphic ? `graphic ${graphicEntry(c.graphic)}` : m ? `${m.name} src ${fmtTime(c.in + (t0 - c.start) * c.speed, 2)}` : '';
    return `${track.id} ${c.id} ${what}`;
  }));
  return { ...n, media: hit?.clip.mediaId, src: hit ? Number(hit.src.toFixed(3)) : undefined, words, onScreen, needsTranscript: hit?.clip.mediaId && p.media.find((m) => m.id === hit.clip.mediaId)?.hasAudio && !tr ? [hit.clip.mediaId] : [] };
}

app.get<P & { Querystring: { all?: string } }>('/api/projects/:name/notes', async (req) => {
  const p = store.get(req.params.name).project;
  return p.notes.filter((n) => req.query.all || n.status === 'open').map((n) => noteContext(req.params.name, p, n));
});

app.get<P & { Querystring: { mediaId: string; from?: string; to?: string } }>('/api/projects/:name/transcript-text', async (req, reply) => {
  const p = store.get(req.params.name).project;
  const t = store.transcript(req.params.name, req.query.mediaId);
  if (!t) return reply.code(404).send({ error: 'no transcript yet' });
  const states = wordStates(p, req.query.mediaId, t.words);
  const from = Math.max(0, Number(req.query.from ?? 0));
  const to = Math.min(t.words.length - 1, Number(req.query.to ?? from + 400));
  const mark = { keep: '', cut: '✂', suggested: '?' } as const;
  const out: string[] = [];
  for (let i = from; i <= to; i++) {
    const w = t.words[i];
    const prev = t.words[i - 1];
    if (prev && w.t0 - prev.t1 > 0.6) out.push(`\n(${(w.t0 - prev.t1).toFixed(1)}s)\n`);
    out.push(`${i}${mark[states[i]]}:${w.w}@${w.t0.toFixed(2)}`);
  }
  reply.type('text/plain; charset=utf-8');
  return `words ${from}–${to} of ${t.words.length} · format index[✂ cut|? suggested]:word@sourceSeconds\n` + out.join(' ');
});

app.post<P & { Body: { t0?: number; t1?: number; count?: number; cols?: number; times?: number[]; width?: number; composite?: boolean } }>('/api/projects/:name/contact-sheet', async (req, reply) => {
  const p = store.get(req.params.name).project;
  const dur = projectDuration(p);
  const times = req.body.times?.length ? req.body.times : evenTimes(req.body.t0 ?? 0, Math.min(req.body.t1 ?? dur, dur - 0.05), Math.min(req.body.count ?? 12, 48));
  const img = await contactSheet(req.params.name, p, projectDir(req.params.name), times.map((t) => ({ t, label: fmtTime(t) })), req.body.cols ?? 4, req.body.width ?? 480, req.body.composite !== false);
  reply.header('x-times', times.map((t) => t.toFixed(2)).join(','));
  reply.type('image/jpeg');
  return img;
});

/** A few seconds of a clip's sound from clip time `at`, cleaned at `strength` (0 = as recorded), to compare before choosing. */
app.post<P & { Params: { id: string }; Body: { strength?: number; at?: number } }>('/api/projects/:name/clips/:id/denoise-preview', async (req, reply) => {
  const p = store.get(req.params.name).project;
  const c = p.clips.find((x) => x.id === req.params.id);
  const m = c?.mediaId ? p.media.find((x) => x.id === c.mediaId) : undefined;
  if (!c || !m?.hasAudio) throw new OpError('هذي اللقطة ما فيها صوت');
  const strength = Math.min(1, Math.max(0, Number(req.body?.strength) || 0));
  const from = Math.min(Math.max(c.in, c.in + (Number(req.body?.at) || 0) * c.speed), Math.max(c.in, c.out - 0.5));
  const len = Math.min(8, c.out - from);
  const dir = projectDir(req.params.name);
  const out = `cache/denoise/${createHash('sha1').update(JSON.stringify([m.path, from, len, strength])).digest('hex').slice(0, 16)}.mp3`;
  if (!existsSync(join(dir, out))) {
    mkdirSync(join(dir, 'cache/denoise'), { recursive: true });
    const af = ['aformat=channel_layouts=stereo', ...denoiseFilters(strength)].join(',');
    await ffmpeg(['-ss', String(from), '-t', String(len), '-i', m.path, '-vn', '-af', af, '-c:a', 'libmp3lame', '-q:a', '4', out], dir);
  }
  return reply.type('audio/mpeg').header('cache-control', 'max-age=86400').send(createReadStream(join(dir, out)));
});

app.get<P & { Querystring: { t?: string } }>('/api/projects/:name/frame', async (req, reply) => {
  const p = store.get(req.params.name).project;
  const t = Math.min(Math.max(0, Number(req.query.t) || 0), Math.max(0, projectDuration(p) - 0.01));
  const img = await frameImage(req.params.name, p, projectDir(req.params.name), t);
  reply.type('image/jpeg');
  return img;
});

/** The home page's cover of a project, and the strip of frames a hover scrubs (cached until the project changes). */
for (const kind of ['cover', 'strip'] as const) {
  app.get<P>(`/api/projects/:name/${kind}.jpg`, async (req, reply) => {
    const rel = await projectCover(req.params.name, store.get(req.params.name).project, projectDir(req.params.name), kind);
    if (!rel) return reply.code(404).send({ error: 'nothing to show yet' });
    if (kind === 'strip') reply.header('x-frames', String(STRIP_FRAMES));
    // the URL carries the project's modification time, so a cached copy is never stale
    return reply.type('image/jpeg').header('cache-control', 'max-age=31536000, immutable').send(createReadStream(join(projectDir(req.params.name), rel)));
  });
}

app.post<P & { Body: { images?: boolean; max?: number } }>('/api/projects/:name/check-cuts', async (req) => {
  const p = store.get(req.params.name).project;
  const cuts = cutReport(p, (m) => store.transcript(req.params.name, m)?.words);
  let image: string | undefined;
  if (req.body?.images !== false && cuts.length) {
    // the cuts with problems first, then the rest, capped
    const pick = [...cuts].sort((a, b) => b.problems.length - a.problems.length).slice(0, req.body?.max ?? 12).sort((a, b) => a.at - b.at);
    // the cuts themselves: main track only, so nothing on top hides a jump
    const buf = await contactSheet(req.params.name, p, projectDir(req.params.name), cutFrames(p, pick, p.settings.fps), 2, 400, false);
    image = buf.toString('base64');
  }
  return { cuts, image };
});

// ---------------------------------------------------------------- sound effects

const isSfx = (id: unknown): id is SfxId => typeof id === 'string' && id in SFX;
const sfxTrackOp: Op = { op: 'add_track', track: { id: SFX_TRACK, kind: 'audio', name: 'مؤثرات' } };
/** The project's copy of an effect (copied in on first use, like any media). */
const sfxMedia = (name: string, id: SfxId) => addMedia(store, jobs, name, sfxFile(id), 'sfx', { analyze: false });

app.get('/api/sfx', async () => sfxList());
app.get<{ Params: { id: string } }>('/api/sfx/:id/audio', async (req, reply) => {
  if (!isSfx(req.params.id)) return reply.code(404).send({ error: 'no such sound effect' });
  return reply.type('audio/wav').header('cache-control', 'max-age=86400').send(createReadStream(sfxFile(req.params.id)));
});
app.post<P & { Body: { id: string; at?: number; volume?: number; author?: string } }>('/api/projects/:name/sfx', async (req) => {
  const { id, at, volume } = req.body ?? {};
  if (!isSfx(id)) throw new OpError(`unknown sound effect ${id} — one of ${Object.keys(SFX).join(', ')}`);
  const m = sfxMedia(req.params.name, id);
  const r = store.apply(req.params.name, [sfxTrackOp, { op: 'add_clip', clip: { trackId: SFX_TRACK, mediaId: m.id, in: 0, out: m.duration, start: Math.max(0, at ?? 0), volume: volume ?? 0.6, label: SFX[id].name } }], req.body?.author ?? 'user');
  return { rev: r.rev, history: store.history(req.params.name), project: r.project };
});
/** Place effects on what happens on screen; replaces the previous automatic ones (◇), keeps the ones placed by hand. */
app.post<P & { Body: { author?: string } }>('/api/projects/:name/sfx/auto', async (req) => {
  const name = req.params.name;
  const p = store.get(name).project;
  const plan = sfxPlan(p);
  const media = new Map([...new Set(plan.map((q) => q.sfx))].map((id) => [id, sfxMedia(name, id)]));
  const old = p.clips.filter((c) => c.trackId === SFX_TRACK && c.label?.startsWith(AUTO_MARK));
  const ops: Op[] = [
    sfxTrackOp,
    ...old.map((c): Op => ({ op: 'delete', clipId: c.id })),
    ...plan.map((q): Op => {
      const m = media.get(q.sfx)!;
      return { op: 'add_clip', clip: { trackId: SFX_TRACK, mediaId: m.id, in: 0, out: m.duration, start: q.at, volume: q.volume, label: `${AUTO_MARK} ${SFX[q.sfx].name}` } };
    }),
  ];
  const r = store.apply(name, ops, req.body?.author ?? 'user');
  return { count: plan.length, removed: old.length, cues: plan, rev: r.rev, history: store.history(name), project: r.project };
});

// ---------------------------------------------------------------- styles (looks you apply in one click)

app.get('/api/styles', async () => ({ presets: STYLE_PRESETS, saved: savedStyles() }));

app.get<{ Querystring: { q?: string; source?: string; offset?: string; limit?: string; category?: string; sort?: string; preview?: string; favorites?: string; use?: string; all?: string } }>('/api/style-library', async (req) => {
  const offset = Number(req.query.offset ?? 0), limit = Number(req.query.limit ?? 30);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new OpError('invalid offset');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 60) throw new OpError('limit must be 1–60');
  return searchStyleCatalog(req.query.q, req.query.source, offset, limit, req.query.category, {
    previewFirst: req.query.sort === 'preview', onlyPreview: req.query.preview === '1', favorites: req.query.favorites === '1' ? favorites() : undefined,
    curated: req.query.sort === 'curated', use: req.query.use || undefined, all: req.query.all === '1',
  });
});

// favourites: library references, looks and saved styles the user liked (all projects); every window sees a change
app.get('/api/style-library/favorites', async () => ({ ids: favorites() }));
app.put<{ Params: { id: string } }>('/api/style-library/favorites/:id', async (req) => {
  const ids = setFavorite(req.params.id, true);
  broadcast({ type: 'favorites', ids });
  return { ids };
});
app.delete<{ Params: { id: string } }>('/api/style-library/favorites/:id', async (req) => {
  const ids = setFavorite(req.params.id, false);
  broadcast({ type: 'favorites', ids });
  return { ids };
});
app.get<{ Params: { id: string } }>('/api/style-library/:id', async (req, reply) => {
  const catalog = styleCatalog();
  const entry = catalog.entries.find((e) => e.id === req.params.id);
  if (!entry) return reply.code(404).send({ error: 'style reference not found' });
  return { ...entry, provenance: catalog.sources.find((s) => s.id === entry.source) };
});
app.post<{ Body: { project: string; name: string; description?: string } }>('/api/styles', async (req) => {
  if (!req.body?.name?.trim()) throw new OpError('a style needs a name');
  const p = store.get(req.body.project).project;
  return { style: saveStyle(p, projectDir(req.body.project), req.body.name, req.body.description) };
});
app.delete<{ Params: { id: string } }>('/api/styles/:id', async (req, reply) => (deleteStyle(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'no such saved style' })));
app.post<P & { Body: { id: string; captions?: boolean; transitions?: boolean; author?: string } }>('/api/projects/:name/apply-style', async (req) => {
  const name = req.params.name;
  const found = resolveStyle(req.body.id, projectDir(name));
  if (!found) throw new OpError(`style ${req.body.id} not found`);
  const p = store.get(name).project;
  const by = req.body.author === 'claude' ? 'claude' : 'user';
  const log: Op = { op: 'log_style', id: found.style.id, name: found.style.name, source: STYLE_PRESETS.some((s) => s.id === found.style.id) ? 'preset' : 'saved', by, what: ['هوية ولون', req.body.captions !== false ? 'تنسيق الكابشن' : '', req.body.transitions ? 'انتقالات' : ''].filter(Boolean).join(' + ') };
  const r = store.apply(name, [...styleOps(p, found.style, { captions: req.body.captions ?? true, transitions: req.body.transitions ?? false }, found.lut), log], by);
  return { rev: r.rev, history: store.history(name), project: r.project, style: found.style.name };
});

// ---------------------------------------------------------------- HTML graphics

app.get('/api/graphics/runtime.js', async (_req, reply) => reply.type('text/javascript; charset=utf-8').send(GRAPHIC_RUNTIME));
app.get('/api/graphics/fonts.css', async (_req, reply) => reply.type('text/css; charset=utf-8').send(fontFaceCss((f) => `/api/graphics/fonts/${basename(f)}`)));
app.get<{ Params: { file: string } }>('/api/graphics/fonts/:file', async (req, reply) => {
  const f = fontFiles().find((x) => basename(x.file) === req.params.file);
  if (!f) return reply.code(404).send({ error: 'no such font' });
  return reply.type(f.file.endsWith('.ttf') ? 'font/ttf' : f.file.endsWith('.otf') ? 'font/otf' : f.file.endsWith('.woff') ? 'font/woff' : 'font/woff2').header('cache-control', 'max-age=86400').send(createReadStream(f.file));
});

/** A graphic folder's template.json {description, duration, data, options, labels, scenes}; {} when it has none. */
function templateInfo(folder: string): Record<string, unknown> {
  const meta = join(folder, 'template.json');
  try { return existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')) : {}; } catch { return { description: 'template.json is not valid JSON' }; }
}

/** Library templates: graphics-lib/<name>/index.html with a template.json. */
function libraryTemplates() {
  return readdirSync(GRAPHICS_LIB_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && existsSync(join(GRAPHICS_LIB_DIR, e.name, 'index.html')))
    .map((e) => ({ graphic: `lib/${e.name}`, ...templateInfo(join(GRAPHICS_LIB_DIR, e.name)) }));
}

/** Does a graphic page take its colours, and its font, from the project identity (the kit, or the theme's CSS variables)? */
function followsTheme(page: string): { themed: boolean; themedFont: boolean } {
  try {
    const html = readFileSync(page, 'utf8');
    const kit = /kit\.(css|js)/.test(html);
    return { themed: kit || /var\(--(accent|accent-2|text|panel)\b/.test(html), themedFont: kit || /var\(--font\b/.test(html) };
  } catch {
    return { themed: false, themedFont: false };
  }
}

/** The project's own compositions in graphics/ (folders with an index.html, loose .html files) and the shared library. */
app.get<P>('/api/projects/:name/graphics', async (req) => {
  const dir = join(projectDir(req.params.name), 'graphics');
  const own = !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() && existsSync(join(dir, e.name, 'index.html')) ? [`graphics/${e.name}`] : e.isFile() && /\.html?$/i.test(e.name) ? [`graphics/${e.name}`] : []);
  // the same metadata as the library for the project's own folders (a template.json next to index.html)
  const ownInfo = own.map((g) => {
    const page = /\.html?$/i.test(g) ? join(dir, g.slice('graphics/'.length)) : join(dir, g.slice('graphics/'.length), 'index.html');
    return { graphic: g, ...(/\.html?$/i.test(g) ? {} : templateInfo(join(dir, g.slice('graphics/'.length)))), ...followsTheme(page) };
  });
  return { project: own, own: ownInfo, library: libraryTemplates() };
});

app.post<P & { Body: { graphic: string; duration: number; data?: Record<string, unknown>; times?: number[]; count?: number; cols?: number; width?: number } }>('/api/projects/:name/graphic-sheet', async (req, reply) => {
  const name = req.params.name;
  const p = store.get(name).project;
  const dur = Number(req.body.duration);
  if (!req.body.graphic || !(dur > 0)) throw new OpError('graphic and duration are required');
  const times = req.body.times?.length ? req.body.times : evenTimes(0, dur, Math.min(req.body.count ?? 8, 24));
  const dir = projectDir(name);
  const tmp = join(dir, 'cache', `gsheet-${Date.now()}`);
  try {
    await graphicStills(name, dir, { graphic: req.body.graphic, out: dur, graphicData: req.body.data }, p.settings, times, req.body.width ?? 640, tmp);
    const img = await tileImages(join(tmp, 'g%03d.png'), times.length, req.body.cols ?? 4, dir);
    reply.header('x-times', times.map((t) => t.toFixed(2)).join(','));
    reply.type('image/jpeg');
    return img;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- render & style jobs

registerExportRoutes(app, store, jobs, async ({ name, project: p, dir, quality, output, export: e, range }, ctx) => {
    const began = performance.now();
    const timings = { graphics: 0, segments: 0, final: 0 };
    const size = outputSize({ ...p.settings, resolution: quality === 'preview' ? Math.min(720, p.settings.resolution) : p.settings.resolution });
    const audio = e?.format === 'mp3' || e?.format === 'wav' ? e.format : undefined;
    ctx.update({ stage: 'text', progress: 0 });
    // sound only: no picture to draw text or graphics on
    const texts = await renderTextImages(dir, audio ? [] : p.clips.filter((c) => c.text && !p.tracks.find((t) => t.id === c.trackId)?.hidden), size.width, size.height, p.settings.theme);
    const shown = (c: { trackId: string; start: number }) => !audio && !p.tracks.find((t) => t.id === c.trackId)?.hidden && c.start < projectDuration(p);
    const graphicStart = performance.now();
    const captures: import('./graphics.ts').GraphicCaptureStats[] = [];
    const graphics = await renderGraphics(name, dir, p.clips.filter((c) => c.graphic && shown(c)), p.settings, size.width, p.settings.fps,
      (g) => ctx.update({ stage: 'graphics', progress: g * 0.3, message: `رسوم ${Math.round(g * 100)}%` }), ctx.signal,
      quality === 'final' ? p.settings.motionBlur : 1, { onStats: (s) => captures.push(s) }); // motion blur only where it's worth the time
    timings.graphics = (performance.now() - graphicStart) / 1000;
    const plan = compile(p, {
      quality, nvenc: hasNvenc(), fileKey: fileKey(dir), output,
      ...(e ? { codec: e.codec, level: e.level, range, audio } : {}),
      textImage: (c) => texts.get(c.id),
      graphicVideo: (c) => graphics.get(c.id),
      blankImage: blankImage(dir, size.width, size.height),
      lutFile: (lut, mix) => bakedLut(dir, lut, mix),
    });
    let stage: 'segments' | 'final' = 'segments', stageStart = performance.now();
    const out = await runPlan(plan, dir, (r) => {
      if (r.stage !== stage) { timings[stage] += (performance.now() - stageStart) / 1000; stage = r.stage; stageStart = performance.now(); }
      ctx.update({ stage: r.stage, progress: r.stage === 'segments' ? 0.3 + r.progress * 0.5 : 0.8 + r.progress * 0.2, message: `${r.done}/${r.total} مقاطع${r.cached ? ` (${r.cached} من الكاش)` : ''}` });
    }, ctx.signal);
    timings[stage] += (performance.now() - stageStart) / 1000;
    recordCacheUse(dir, p, [
      ...[...graphics].map(([clipId, path]) => ({ path, clipIds: [clipId] })),
      ...plan.segments.map((s) => ({ path: s.output, clipIds: p.clips.some((c) => c.id === s.clipId) ? [s.clipId] : p.clips.filter((c) => c.trackId === 'V1').map((c) => c.id) })),
    ]);
    return { output: out, url: `/files/${encodeURIComponent(name)}/${out}`, duration: plan.duration, seconds: (performance.now() - began) / 1000, timings, captures, segments: plan.segments.length };
});

app.post<P & { Body: { refMediaId: string; strength?: number; apply?: 'default' | 'all' | 'none' } }>('/api/projects/:name/style', async (req) => {
  const name = req.params.name;
  const p0 = store.get(name).project;
  const ref = p0.media.find((m) => m.id === req.body.refMediaId);
  if (!ref) throw new OpError(`reference ${req.body.refMediaId} not found`);
  const job = jobs.add('style', name, `ستايل من ${ref.name}`, async (ctx) => {
    const p = store.get(name).project;
    const sources = p.media.filter((m) => m.role === 'source' && m.kind === 'video').map((m) => m.path);
    const res = await runPython(PYTHON, [join(ANALYSIS_DIR, 'style.py'), '--project', projectDir(name), '--ref', ref.path, '--ref-id', ref.id, '--name', ref.name,
      ...sources.flatMap((s) => ['--source', s]), '--strength', String(req.body.strength ?? 0.7)], ANALYSIS_DIR, ctx);
    const apply = req.body.apply ?? 'default';
    const ops = [{ op: 'set_style' as const, style: res.style }];
    if (apply !== 'none' && res.lut) {
      ops.push({ op: 'set_grade', grade: { lut: res.lut, lutMix: 1 }, ...(apply === 'default' ? { asDefault: true } : {}) } as never);
    }
    store.apply(name, ops, 'style');
    return res;
  });
  return { job };
});

app.get<P>('/api/projects/:name/luts', async (req) => {
  const dir = join(projectDir(req.params.name), 'luts');
  return existsSync(dir) ? readdirSync(dir).filter((f) => /\.cube$/i.test(f)).map((f) => `luts/${f}`) : [];
});

app.get<{ Querystring: { project?: string } }>('/api/jobs', async (req) => [...jobs.list(req.query.project), ...agentJobs.list(req.query.project)].sort((a, b) => b.createdAt - a.createdAt));
app.get<{ Params: { id: string }; Querystring: { wait?: string } }>('/api/jobs/:id', async (req, reply) => {
  const queue = agentJobs.get(req.params.id) ? agentJobs : jobs;
  const job = req.query.wait ? await queue.wait(req.params.id, Math.min(Number(req.query.wait), 600_000)) : queue.get(req.params.id);
  if (!job) return reply.code(404).send({ error: 'job not found' });
  return job;
});
app.post<{ Params: { id: string } }>('/api/jobs/:id/cancel', async (req) => ({ ok: jobs.cancel(req.params.id) || agentJobs.cancel(req.params.id) }));

// ---------------------------------------------------------------- AI tasks typed in the editor

/** Which model a request needs (rules, else a small model's guess) — shown before anything is spent. */
app.post<P & { Body: { text: string } }>('/api/projects/:name/agent/route', async (req) => {
  store.get(req.params.name);
  const text = String(req.body?.text ?? '').trim();
  if (!text) throw new OpError('اكتب الطلب أول');
  return routeTask(text);
});

app.post<P & { Body: AgentRequest }>('/api/projects/:name/agent', async (req) => {
  const name = req.params.name;
  store.get(name);
  const body = req.body ?? ({} as AgentRequest);
  return { job: startAgent(name, { ...body, notes: Array.isArray(body.notes) ? body.notes.map(String) : undefined, ideas: body.ideas === true }) };
});

/** Queue an AI task; one built from comments refuses comments a task is already on. */
function startAgent(name: string, body: AgentRequest) {
  let text = String(body.text ?? '').trim();
  const notes = body.notes;
  if (notes) {
    // the label says which comments; the request itself is built from them by the agent
    const all = store.get(name).project.notes;
    const picked = notes.map((id) => all.find((n) => n.id === id));
    if (!notes.length || picked.some((n) => !n)) throw new OpError('التعليق ما عاد موجود');
    if (agentJobs.list(name).some((j) => (j.status === 'queued' || j.status === 'running') && j.notes?.some((id) => notes.includes(id)))) throw new OpError('الذكاء شغّال على هذا التعليق');
    text ||= picked.length === 1 ? `تعليق: ${picked[0]!.text}` : `${picked.length} تعليقات`;
  }
  if (body.ideas) {
    if (agentJobs.list(name).some((j) => (j.status === 'queued' || j.status === 'running') && j.ideas)) throw new OpError('الذكاء يجهّز أفكار لهذا المشروع الحين');
    text ||= 'اقترح بي-رول وشروحات';
  }
  if (!text) throw new OpError('اكتب الطلب أول');
  if (!['quick', 'standard', 'deep'].includes(body.tier)) throw new OpError('tier must be quick, standard or deep');
  return agentJobs.add('agent', name, text.length > 60 ? `${text.slice(0, 60)}…` : text,
    (ctx) => runAgent(ctx, name, { text, tier: body.tier, time: body.time, selected: body.selected, notes, ideas: body.ideas }), notes ? { notes } : body.ideas ? { ideas: true } : undefined);
}

/** settings.aiNotes: each new user comment starts its own task, unless it needs the deep tier (that waits for a click). */
function autoNotes(name: string, added: Note[]) {
  for (const n of added) {
    const { tier } = routeNotes([n.text]);
    if (tier === 'deep') continue;
    try { startAgent(name, { text: '', tier, notes: [n.id] }); } catch (e) { app.log.warn(e); }
  }
}

app.get<P>('/api/projects/:name/agent/log', async (req) => taskLog(projectDir(req.params.name)));

app.get<P & { Params: { mediaId: string; file: string } }>('/api/projects/:name/analysis/:mediaId/:file', async (req, reply) => {
  if (!/^[\w.-]+\.json$/.test(req.params.file)) return reply.code(400).send({ error: 'bad file' });
  if (req.params.file === 'peaks.json') return peakCache.get(req.params.name, req.params.mediaId);
  if (!store.get(req.params.name).project.media.some((m) => m.id === req.params.mediaId)) throw new OpError('media not found');
  const data = readAnalysis(req.params.name, req.params.mediaId, req.params.file);
  if (!data) return reply.code(404).send({ error: 'not analysed yet' });
  return data;
});

await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`edit-tool server on http://127.0.0.1:${PORT}  (projects: ${PROJECTS_DIR}, nvenc: ${hasNvenc()})`);
