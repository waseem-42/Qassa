import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CAPTION_TRACK, captionsSrt, clipDuration, clipEnd, exportBaseName, exportRange, ExportSettings, graphicEntry, isAudioFormat, mainClips, markedRange, OpError, projectDuration, MAIN_TRACK, type Project } from '@edit/shared';
import { editReview, trackOverlaps, type ReviewFinding } from '@edit/shared';
import { BROWSER, GRAPHICS_LIB_DIR } from './config.ts';
import { assertNoLink, assertWithin, ProjectManagementError } from './project-paths.ts';
import { fontFiles } from './textimg.ts';
import { cutReport } from './sheets.ts';
import type { JobContext, Jobs } from './jobs.ts';
import type { Store } from './store.ts';

/** Graphics whose template.json says `opaque: true` paint the whole frame (the review counts them as picture, not black). */
export function opaqueGraphics(dir: string, libDir = GRAPHICS_LIB_DIR): (graphic: string) => boolean {
  const seen = new Map<string, boolean>();
  return (graphic) => {
    if (!seen.has(graphic)) {
      const folder = graphic.startsWith('lib/') ? join(libDir, graphic.slice(4)) : join(dir, graphic);
      let opaque = false;
      try { opaque = JSON.parse(readFileSync(join(folder, 'template.json'), 'utf8')).opaque === true; } catch { /* no template.json: a layer over the picture */ }
      seen.set(graphic, opaque);
    }
    return seen.get(graphic)!;
  };
}

const Quality = z.enum(['preview', 'final']);
const RenderBody = z.object({ quality: Quality.default('preview'), output: z.string().max(1000).optional(), expectedRev: z.number().int().nonnegative().optional(), export: ExportSettings.optional(), marked: z.boolean().default(false) });
export type RenderQuality = z.infer<typeof Quality>;
export interface ExportIssue { code: string; message: string; clipId?: string; mediaId?: string; path?: string }
export interface ExportResource {
  kind: 'media' | 'proxy' | 'graphic' | 'lut' | 'font' | 'browser';
  path: string;
  status: 'ready' | 'missing' | 'unverified';
  mediaId?: string;
  clipId?: string;
}
export interface ExportPreflight {
  ready: boolean;
  rev: number;
  snapshotId: string;
  quality: RenderQuality;
  blockers: ExportIssue[];
  warnings: ExportIssue[];
  resources: ExportResource[];
  /** what a viewer would notice (never blocks) */
  review?: ReviewFinding[];
}
export interface RenderInfo {
  rev: number; snapshotId: string; quality: RenderQuality; output: string;
  /** how this export differs from the project (absent: exactly as the project is set) */
  export?: ExportSettings;
  /** the exported part of the timeline, seconds */
  range?: [number, number];
  /** captions written beside the output */
  srt?: string;
}
export interface RenderSnapshot extends RenderInfo { project: Project; dir: string; name: string }
interface CheckOptions { graphicsDir?: string; fonts?: string[]; browser?: string | null }

export const projectSnapshotId = (project: Project) => createHash('sha256').update(JSON.stringify(project)).digest('hex');

/** Relative dependencies may not escape their project/library, including through a junction. */
function dependencyPath(root: string, path: string, external = false): string {
  if (!path || /[\u0000-\u001f]/u.test(path)) throw new Error('invalid dependency path');
  if (isAbsolute(path)) {
    if (external) return path;
    throw new Error('dependency must be project-relative');
  }
  const file = resolve(root, path);
  assertWithin(root, file);
  if (existsSync(file)) assertWithin(realpathSync(root), realpathSync(file));
  return file;
}

function readable(file: string): boolean {
  try { accessSync(file, constants.R_OK); return statSync(file).isFile(); } catch { return false; }
}

/** Static checks only: no ffprobe, browser launch, target execution, or project mutation. */
export function exportPreflight(project: Project, rev: number, dir: string, quality: RenderQuality = 'final', options: CheckOptions = {}): ExportPreflight {
  const blockers: ExportIssue[] = [], warnings: ExportIssue[] = [], resources: ExportResource[] = [];
  const snapshotId = projectSnapshotId(project);
  const tracks = new Map(project.tracks.map((t) => [t.id, t]));
  const media = new Map(project.media.map((m) => [m.id, m]));
  const duration = projectDuration(project);
  if (!tracks.has(MAIN_TRACK)) blockers.push({ code: 'missing_main_track', message: 'المسار الرئيسي غير موجود.' });
  if (!project.clips.length) blockers.push({ code: 'empty_project', message: 'أضف لقطة إلى أي مسار قبل التصدير.' });
  if (!(project.settings.fps > 0) || !(project.settings.resolution > 0)) blockers.push({ code: 'invalid_settings', message: 'الدقة ومعدل الإطارات يجب أن يكونا أكبر من صفر.' });
  const checked = new Map<string, boolean>();
  const check = (kind: ExportResource['kind'], root: string, path: string, context: Pick<ExportIssue, 'clipId' | 'mediaId'> = {}, external = false): boolean => {
    const key = `${kind}:${root}:${path}`;
    if (checked.has(key)) return checked.get(key)!;
    let ok = false;
    try { ok = readable(dependencyPath(root, path, external)); } catch { /* report invalid/escaped paths as unavailable */ }
    resources.push({ kind, path, status: ok ? 'ready' : 'missing', ...context });
    checked.set(key, ok);
    return ok;
  };
  let needsFonts = false;
  const usedFonts = new Set<string>();
  for (const clip of project.clips) {
    const track = tracks.get(clip.trackId);
    const isMain = clip.trackId === MAIN_TRACK;
    if (!isMain && clip.start >= duration) continue;
    if (!track) { blockers.push({ code: 'unknown_track', message: 'لقطة مرتبطة بمسار غير موجود.', clipId: clip.id }); continue; }
    const visual = isMain || (track.kind !== 'audio' && !track.hidden);
    const audible = (track.kind === 'audio' || (track.kind === 'overlay' && clip.picture?.off)) && !track.muted;
    if (!visual && !audible) continue;
    const context = { clipId: clip.id, ...(clip.mediaId ? { mediaId: clip.mediaId } : {}) };
    if (!(clipDuration(clip) > 0) || !Number.isFinite(clipDuration(clip))) blockers.push({ code: 'empty_clip', message: 'لقطة لها مدة غير صالحة.', ...context });
    if (clip.graphic && !isMain) {
      if (!visual || track.kind === 'audio') continue;
      const entry = graphicEntry(clip.graphic), library = entry.startsWith('lib/');
      if (!check('graphic', library ? options.graphicsDir ?? GRAPHICS_LIB_DIR : dir, library ? entry.slice(4) : entry, context)) {
        blockers.push({ code: 'missing_graphic', message: 'صفحة الرسم غير موجودة أو غير قابلة للقراءة.', path: entry, ...context });
      }
      needsFonts = true;
      usedFonts.add(project.settings.theme.font);
      continue;
    }
    if (clip.text && !isMain && track.kind === 'text') {
      needsFonts = true;
      usedFonts.add(clip.textStyle?.font ?? project.settings.theme.font);
      continue;
    }
    if (clip.gap) continue; // black and silent, made by the render
    const m = clip.mediaId ? media.get(clip.mediaId) : undefined;
    if (!m) { blockers.push({ code: 'missing_media_reference', message: 'لقطة مرتبطة بملف غير مسجّل في المشروع.', ...context }); continue; }
    // Match compiler inputs: audio tracks always read originals; visible video layers may use proxies.
    const consumes = isMain || (track.kind === 'overlay' && visual && m.kind !== 'audio') || (audible && m.hasAudio);
    if (!consumes) continue;
    if (m.kind !== 'image' && m.duration > 0 && clip.out > m.duration + 0.05) blockers.push({ code: 'source_range', message: 'نهاية اللقطة تتجاوز مدة الملف.', ...context });
    const original = check('media', dir, m.path, context, true);
    let proxy = false;
    if (quality === 'preview' && track.kind !== 'audio' && (isMain || !clip.picture?.off) && m.proxy) {
      proxy = check('proxy', dir, m.proxy, context);
      if (!proxy) warnings.push({ code: 'missing_proxy', message: 'البروكسي غير متاح؛ ستُستخدم النسخة الأصلية للمعاينة.', path: m.proxy, ...context });
    }
    if (!original && !proxy) blockers.push({ code: 'missing_media', message: 'ملف مستخدم في التصدير غير موجود أو غير قابل للقراءة.', path: m.path, ...context });
    else if (!original) warnings.push({ code: 'missing_original', message: 'الأصل غير متاح؛ هذه المعاينة تعتمد على البروكسي فقط.', path: m.path, ...context });
    if (isAbsolute(m.path)) warnings.push({ code: 'external_media', message: 'ملف مصدر خارج المشروع؛ يجب أن يبقى متاحًا أثناء التصدير.', path: m.path, ...context });
    if (!clip.picture?.off && m.kind !== 'audio' && (isMain || (track.kind === 'overlay' && visual))) {
      const grade = clip.grade ?? project.settings.defaultGrade;
      if (grade?.lut && grade.lutMix > 0.001 && !check('lut', dir, grade.lut, context)) blockers.push({ code: 'missing_lut', message: 'ملف تلوين مستخدم غير موجود أو غير قابل للقراءة.', path: grade.lut, ...context });
    }
  }
  if (needsFonts) {
    const fonts = options.fonts ?? fontFiles().map((f) => f.file);
    for (const file of fonts) resources.push({ kind: 'font', path: file, status: readable(file) ? 'ready' : 'missing' });
    if (!fonts.length || fonts.some((file) => !readable(file))) warnings.push({ code: 'font_files', message: 'بعض ملفات الخط المرفق غير متاحة؛ قد يستخدم العرض خطًا بديلًا.' });
    for (const font of usedFonts) if (font !== 'IBM Plex Sans Arabic') {
      resources.push({ kind: 'font', path: font, status: 'unverified' });
      warnings.push({ code: 'custom_font', message: `لم يُتحقق من توفر الخط «${font}» أو تغطيته للحروف.` });
    }
    const browser = options.browser === undefined ? BROWSER : options.browser;
    resources.push({ kind: 'browser', path: browser || '', status: browser && readable(browser) ? 'ready' : 'missing' });
    if (!browser || !readable(browser)) warnings.push({ code: 'render_browser', message: 'متصفح رندر النصوص والرسوم غير متاح؛ قد يفشل توليد عناصر غير مخزنة في الكاش.' });
  }
  if (project.notes.some((n) => n.status === 'open')) warnings.push({ code: 'open_notes', message: 'توجد تعليقات لم تُنجز بعد.' });
  if (project.suggestions.length) warnings.push({ code: 'pending_suggestions', message: 'توجد اقتراحات تحرير لم تُراجع بعد.' });
  for (const track of project.tracks.filter((t) => t.id !== MAIN_TRACK && (t.kind === 'audio' ? !t.muted : !t.hidden))) {
    if (trackOverlaps(project, track.id).length) warnings.push({ code: 'overlapping_clips', message: `توجد مقاطع متداخلة على مسار «${track.name}»؛ قد تغطي إحداها الأخرى.` });
  }
  for (const track of project.tracks.filter((t) => !t.hidden && (t.id === CAPTION_TRACK || project.clips.some((c) => c.trackId === t.id && c.words)))) {
    const captions = project.clips.filter((c) => c.trackId === track.id && c.text !== undefined).sort((a, b) => a.start - b.start);
    let end = -Infinity;
    if (captions.some((c) => { const overlap = c.start < end - .001; end = Math.max(end, clipEnd(c)); return overlap; })) warnings.push({ code: 'overlapping_captions', message: `توجد كابشنات متداخلة على مسار «${track.name}»؛ راجع توقيتها قبل التصدير.` });
  }
  return { ready: blockers.length === 0, rev, snapshotId, quality, blockers, warnings, resources };
}

/** Confine video outputs to renders/, checking every existing ancestor without following links. */
export function renderOutput(dir: string, output: string): string {
  const path = output.replace(/\\/g, '/');
  const parts = path.split('/');
  if (parts.length < 2 || parts[0] !== 'renders' || !/\.(mp4|mov|mkv|mp3|wav)$/i.test(path) || parts.some((part) => !part || part === '.' || part === '..' || /[<>:"|?*\u0000-\u001f]/u.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(?:\.|$)/i.test(part))) {
    throw new ProjectManagementError('output must be a safe video/audio path under renders/, e.g. renders/cut-v2.mp4', 400);
  }
  const abs = resolve(dir, path);
  assertWithin(dir, abs);
  let ancestor = dir;
  assertNoLink(ancestor);
  for (const part of parts) {
    ancestor = join(ancestor, part);
    assertNoLink(ancestor);
    if (ancestor !== abs && existsSync(ancestor) && !statSync(ancestor).isDirectory()) throw new ProjectManagementError('output parent is not a directory', 400);
  }
  // lstat, unlike exists, also detects a dangling destination link.
  try { lstatSync(abs); } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return path; throw err; }
  throw new ProjectManagementError('output already exists; choose a new filename', 409);
}

type SnapshotRenderer = (snapshot: RenderSnapshot, ctx: JobContext) => Promise<Record<string, unknown>>;

/** Kept separate from the real encoder so queue/HTTP behavior can be verified with an isolated Store. */
export function registerExportRoutes(app: FastifyInstance, store: Store, jobs: Jobs, render: SnapshotRenderer, checkOptions: CheckOptions = {}) {
  const reservations = new Set<string>();
  const jobOutputs = new Map<string, string>();
  const outputKey = (dir: string, output: string) => process.platform === 'win32' ? resolve(dir, output).toLowerCase() : resolve(dir, output);
  const release = (job: { id: string; status: string }) => {
    if (['done', 'error', 'cancelled'].includes(job.status)) {
      const key = jobOutputs.get(job.id);
      if (key) reservations.delete(key);
      jobOutputs.delete(job.id);
    }
  };
  jobs.on('job', release);
  app.addHook('onClose', async () => { jobs.off('job', release); });
  const check = (project: Project, rev: number, dir: string, quality: RenderQuality, name: string, aspect?: Project['settings']['aspect']) => {
    const report = exportPreflight(project, rev, dir, quality, checkOptions);
    try {
      const problems = cutReport(project, (id) => store.transcript(name, id)?.words).filter((c) => c.problems.length);
      if (problems.length) report.warnings.push({ code: 'cut_problems', message: `توجد ${problems.length} نقاط قص تحتاج مراجعة؛ الفحص اقتراح وليس حكمًا على جودة المونتاج.` });
    } catch { report.warnings.push({ code: 'cut_check_unavailable', message: 'تعذر قراءة التفريغ لفحص حدود القص؛ يمكن متابعة التصدير.' }); }
    report.review = editReview(project, { aspect, opaque: opaqueGraphics(dir) });
    const flagged = report.review.filter((f) => f.severity === 'warn').length;
    if (flagged) report.warnings.push({ code: 'edit_review', message: `مراجعة المونتاج: ${flagged} ملاحظة قد يلاحظها المشاهد (التفاصيل في «مراجعة المونتاج»).` });
    return report;
  };
  app.get<{ Params: { name: string }; Querystring: { aspect?: string } }>('/api/projects/:name/review', async (req) => {
    const aspect = z.enum(['16:9', '9:16', '1:1', '4:5']).optional().parse(req.query.aspect);
    return editReview(store.get(req.params.name).project, { aspect, opaque: opaqueGraphics(store.dir(req.params.name)) });
  });
  app.get<{ Params: { name: string }; Querystring: { quality?: string; aspect?: string } }>('/api/projects/:name/render/preflight', async (req) => {
    const quality = Quality.parse(req.query.quality ?? 'final');
    const aspect = ExportSettings.shape.aspect.parse(req.query.aspect);
    const entry = store.get(req.params.name);
    return check(entry.project, entry.rev, store.dir(req.params.name), quality, req.params.name, aspect);
  });
  app.post<{ Params: { name: string }; Body: unknown }>('/api/projects/:name/render', async (req, reply) => {
    const body = RenderBody.parse(req.body ?? {}), name = req.params.name;
    // No await between checking the revision, cloning state and queue registration.
    const entry = store.get(name), rev = entry.rev;
    if (body.expectedRev !== undefined && body.expectedRev !== rev) return reply.code(409).send({ error: 'project changed; refresh export readiness', code: 'stale_revision', rev });
    const project = structuredClone(entry.project), dir = store.dir(name);
    const preflight = check(project, rev, dir, body.quality, name, body.export?.aspect);
    if (!preflight.ready) return reply.code(409).send({ error: 'project is not ready to export', code: 'export_not_ready', preflight });
    const marks = body.marked ? markedRange(project) : undefined;
    if (body.marked && !marks) throw new OpError('حدّد علامتي In وOut قبل تصدير المحدد.');
    const e = body.marked ? ExportSettings.parse({ ...body.export, range: marks }) : body.export, format = e?.format ?? 'mp4';
    const range = exportRange(project, e ?? {});
    if (!range) return reply.code(400).send({ error: 'the export range is empty', code: 'empty_range' });
    const wantsSrt = !!e && (e.captions === 'srt' || e.captions === 'both') && !!captionsSrt(project, range);
    const free = (path: string) => { try { renderOutput(dir, path); return !reservations.has(outputKey(dir, path)); } catch { return false; } };
    let output: string;
    if (body.output) output = renderOutput(dir, body.output);
    else if (e?.fileName !== undefined) {
      // a name the user chose: keep it, numbering only when that file (or its captions) already exists
      const base = exportBaseName(e.fileName, name);
      let i = 1;
      do output = `renders/${base}${i > 1 ? ` (${i})` : ''}.${format}`;
      while (++i < 1000 && !(free(output) && (!wantsSrt || !existsSync(join(dir, output.replace(/\.\w+$/, '.srt'))))));
      output = renderOutput(dir, output);
    } else output = renderOutput(dir, `renders/${body.quality}-r${rev}-${randomUUID()}.${format}`);
    const key = outputKey(dir, output);
    if (reservations.has(key)) return reply.code(409).send({ error: 'output is reserved by another render', code: 'output_conflict' });
    const info: RenderInfo = { rev, snapshotId: preflight.snapshotId, quality: body.quality, output, ...(e ? { export: e, range } : {}), ...(wantsSrt ? { srt: output.replace(/\.\w+$/, '.srt') } : {}) };
    const srtBody = wantsSrt ? captionsSrt(project, range) : '';
    if (e) {
      // the render's private copy: another frame/size/rate, and captions left out of the picture
      project.settings = { ...project.settings, ...(e.aspect ? { aspect: e.aspect } : {}), ...(e.resolution ? { resolution: e.resolution } : {}), ...(e.fps ? { fps: e.fps } : {}) };
      if (e.captions === 'srt' || e.captions === 'none' || isAudioFormat(format)) for (const t of project.tracks) if (t.id === CAPTION_TRACK) t.hidden = true;
    }
    // The compiler trusts a declared proxy. Drop only missing proxies in our private render copy.
    if (body.quality === 'preview') for (const resource of preflight.resources) if (resource.kind === 'proxy' && resource.status === 'missing') {
      for (const m of project.media) if (m.proxy === resource.path) delete m.proxy;
    }
    reservations.add(key);
    try {
      const job = jobs.add('render', name, body.quality === 'final' ? 'رندر نهائي' : 'رندر معاينة', async (ctx) => {
        renderOutput(dir, output); // detect files/links that appeared while queued
        const result = await render({ ...info, project, dir, name }, ctx);
        if (info.srt) writeFileSync(join(dir, info.srt), srtBody, 'utf8');
        return { ...result, ...info };
      }, { render: info });
      jobOutputs.set(job.id, key);
      return { job, render: info };
    } catch (err) { reservations.delete(key); throw err; }
  });
  /** Open the file manager on a finished export (this is a local tool: the server runs on the user's machine). */
  app.post<{ Params: { name: string }; Body: unknown }>('/api/projects/:name/renders/reveal', async (req, reply) => {
    const { output } = z.object({ output: z.string().max(1000) }).parse(req.body ?? {});
    const dir = store.dir(req.params.name), path = output.replace(/\\/g, '/');
    if (!path.startsWith('renders/') || path.split('/').some((p) => p === '..' || !p)) return reply.code(400).send({ error: 'not an export' });
    const abs = resolve(dir, path);
    assertWithin(join(dir, 'renders'), abs);
    if (!existsSync(abs)) return reply.code(404).send({ error: 'file not found' });
    const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [`/select,"${abs}"`]] : process.platform === 'darwin' ? ['open', ['-R', abs]] : ['xdg-open', [join(abs, '..')]];
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: process.platform === 'win32' }).on('error', () => {}).unref();
    return { ok: true };
  });
}
