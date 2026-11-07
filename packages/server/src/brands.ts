import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { BrandKit, OpError, type Theme } from '@edit/shared';
import { DATA_DIR } from './config.ts';
import { assertNoLink, assertWithin } from './project-paths.ts';
import { runBrandAgent } from './agent.ts';
import type { Store } from './store.ts';
import type { Jobs } from './jobs.ts';

const COLOR = /^(#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})|(?:rgb|hsl)a?\([\d\s.,%/+-]+\))$/i;
const HEX = /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{3}\b/gi;
const FAMILY = /^[\p{L}\p{N} _.-]{1,100}$/u;
const ALLOWED = /\.(md|json|css|html?|zip|svg|png|jpe?g|webp|pdf|woff2?|ttf|otf)$/i;
const ASSET = /\.(svg|png|jpe?g|webp|woff2?|ttf|otf)$/i;
const MAX_BYTES = 32 * 1024 * 1024;
export const BRANDS_DIR = process.env.EDIT_BRANDS_DIR ? resolve(process.env.EDIT_BRANDS_DIR) : join(DATA_DIR, 'brands');

function field(name: string): keyof Theme | undefined {
  const key = name.toLowerCase().replace(/[_ .]/g, '-');
  if (/accent-?2|secondary|ثان/.test(key)) return 'accent2';
  if (/accent|primary|brand-(color|\d)|مميز|مميّز|أساسي|رئيسي/.test(key)) return 'accent';
  if (/background|panel|surface|(?:^|-)bg(?:-|$)|خلفية/.test(key)) return 'panel';
  if (/text|foreground|ink|كتابة|نص/.test(key)) return 'text';
}

/** Flatten token objects while retaining semantic names and resolving W3C aliases. */
function jsonTokens(input: unknown): [string, string][] {
  const pairs: [string, string][] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') pairs.push([path, value]);
    else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}-${i}`));
    else if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if ('$value' in obj || 'value' in obj) walk(obj.$value ?? obj.value, path);
      else for (const [k, v] of Object.entries(obj)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(input, '');
  const lookup = new Map(pairs);
  return pairs.map(([k, v]) => {
    for (let i = 0; i < 10 && /^\{[^}]+\}$/.test(v); i++) v = lookup.get(v.slice(1, -1)) ?? v;
    return [k, v];
  });
}

export function parseBrand(files: { name: string; text: string }[]): Pick<BrandKit, 'theme' | 'palette' | 'notes' | 'name'> {
  const theme: Partial<Theme> = {}, palette: BrandKit['palette'] = [];
  let name = '', notes = '';
  const add = (key: string, value: string) => {
    value = value.trim().replace(/\s*!important$/, '');
    if (COLOR.test(value)) {
      if (!palette.some((p) => p.color.toLowerCase() === value.toLowerCase())) palette.push({ name: key.slice(0, 100), color: value });
      const target = field(key);
      if (target && target !== 'font' && target !== 'direction') theme[target] ??= value;
    }
    if (/font|خط/i.test(key) && !/weight|size|height|style/i.test(key)) {
      const family = value.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      if (FAMILY.test(family)) theme.font ??= family;
    }
    if (/direction|اتجاه/i.test(key) && /^(auto|rtl|ltr)$/.test(value)) theme.direction = value as Theme['direction'];
  };
  for (const file of files) {
    const text = file.text;
    if (/\.json$/i.test(file.name)) {
      try {
        const obj = JSON.parse(text);
        if (typeof obj.name === 'string') name ||= obj.name.slice(0, 120);
        if (typeof obj.notes === 'string' || typeof obj.voice === 'string') notes ||= String(obj.notes ?? obj.voice).slice(0, 6000);
        jsonTokens(obj).forEach(([k, v]) => add(k, v));
      } catch { /* a malformed JSON file can still contain readable tokens */ }
    }
    for (const match of text.matchAll(/(--[\w-]+|font-family|direction)\s*:\s*([^;{}\n]+)/gi)) add(match[1], match[2]);
    const plain = text.replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|quot);/g, ' ');
    for (const line of plain.split(/[\n;]/)) {
      const colors = line.match(HEX) ?? [];
      for (const color of colors) add(line.slice(0, line.indexOf(color)).replace(/[*`|:#]/g, '').trim(), color);
    }
    name ||= text.match(/^#\s+(.+)$/m)?.[1]?.slice(0, 120) ?? '';
    notes ||= text.match(/(?:voice|tone|نبرة|صوت الهوية)\s*[:：]\s*([^\n<]+)/i)?.[1]?.trim().slice(0, 6000) ?? '';
  }
  return { name: name || 'هوية جديدة', theme, palette: palette.slice(0, 80), notes };
}

export class Brands {
  constructor(public readonly root = BRANDS_DIR) {}
  dir(id: string) {
    if (!BrandKit.shape.id.safeParse(id).success) throw new OpError('invalid brand ID');
    assertNoLink(this.root);
    const dir = join(this.root, id); assertWithin(this.root, dir); assertNoLink(dir);
    return dir;
  }
  file(id: string, path: string) {
    const dir = this.dir(id), file = resolve(dir, path);
    assertWithin(dir, file);
    let part = dirname(file);
    while (part !== dir) { assertNoLink(part); part = dirname(part); }
    assertNoLink(file); return file;
  }
  read(id: string): BrandKit {
    const file = this.file(id, 'brand.json');
    if (!existsSync(file)) throw new OpError('brand not found');
    return BrandKit.parse(JSON.parse(readFileSync(file, 'utf8')));
  }
  list(): BrandKit[] {
    if (!existsSync(this.root)) return [];
    assertNoLink(this.root);
    return readdirSync(this.root).flatMap((id) => { try { return [this.read(id)]; } catch { return []; } }).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
  save(kit: BrandKit) {
    const parsed = BrandKit.parse(kit);
    for (const value of Object.values(parsed.theme)) {
      if (typeof value !== 'string' || /[<>;{}\\\n\r]/.test(value)) throw new OpError('invalid theme value');
    }
    for (const key of ['accent', 'accent2', 'panel', 'text'] as const) if (parsed.theme[key] && !COLOR.test(parsed.theme[key]!)) throw new OpError('invalid brand colour');
    if (parsed.theme.font && !FAMILY.test(parsed.theme.font)) throw new OpError('invalid font family');
    parsed.logos.forEach((p) => { if (!/\.(svg|png|jpe?g|webp)$/i.test(p) || !existsSync(this.file(kit.id, p))) throw new OpError('invalid logo'); });
    parsed.fonts.forEach((f) => { if (!FAMILY.test(f.family) || !/\.(woff2?|ttf|otf)$/i.test(f.file) || !existsSync(this.file(kit.id, f.file))) throw new OpError('invalid font'); });
    writeFileSync(this.file(kit.id, 'brand.json'), JSON.stringify(parsed, null, 2));
    return parsed;
  }
  upload(filename: string, bytes: Buffer): BrandKit {
    const source = basename(filename.replace(/\\/g, '/'));
    if (!ALLOWED.test(source) || bytes.length > MAX_BYTES) throw new OpError('unsupported identity file or larger than 32 MB');
    const id = randomUUID(), dir = this.dir(id);
    mkdirSync(dir, { recursive: true });
    const original = `original${extname(source).toLowerCase()}`;
    writeFileSync(this.file(id, original), bytes);
    let files: { name: string; bytes: Buffer }[] = [{ name: source, bytes }];
    if (/\.zip$/i.test(source)) {
      // Check central-directory sizes before decompressing; archive paths are never extraction destinations.
      try {
        const entries = new AdmZip(bytes).getEntries().filter((f) => !f.isDirectory);
        if (entries.length > 256 || entries.reduce((sum, f) => sum + f.header.size, 0) > MAX_BYTES || entries.some((f) => ((f.header.attr >>> 16) & 0xf000) === 0xa000)) throw new Error('unsafe ZIP');
        files = entries.map((f) => ({ name: f.entryName, bytes: f.getData() }));
      } catch { throw new OpError('invalid ZIP, links, or archive larger than 32 MB'); }
    }
    const text: { name: string; text: string }[] = [], logos: string[] = [], fonts: BrandKit['fonts'] = [];
    const assets: { path: string; source: string }[] = [];
    for (const [i, file] of files.entries()) {
      if (/\.(md|json|css|html?)$/i.test(file.name)) text.push({ name: file.name, text: file.bytes.toString('utf8').slice(0, 1000000) });
      if (!ASSET.test(file.name)) continue;
      const path = `assets/${id}-${i}-${basename(file.name.replace(/\\/g, '/')).replace(/[^\p{L}\p{N}_.-]/gu, '_')}`;
      mkdirSync(join(dir, 'assets'), { recursive: true }); writeFileSync(this.file(id, path), file.bytes);
      assets.push({ path, source: file.name.replace(/\\/g, '/') });
      if (/logo|mark|icon|شعار/i.test(file.name) && /\.(svg|png|jpe?g|webp)$/i.test(file.name)) logos.push(path);
      if (/\.(woff2?|ttf|otf)$/i.test(file.name)) fonts.push({ family: basename(file.name, extname(file.name)).replace(/[^\p{L}\p{N} _.-]/gu, ' ').slice(0, 100), file: path });
    }
    for (const { text: css } of text) for (const face of css.matchAll(/@font-face\s*\{([^}]+)\}/gi)) {
      const family = face[1].match(/font-family\s*:\s*['"]?([^;'"}]+)/i)?.[1]?.trim();
      const source = face[1].match(/url\(\s*['"]?([^)'"?]+)/i)?.[1];
      const asset = source && assets.find((a) => a.source.endsWith(source.replace(/^\.\//, '')) || basename(a.source) === basename(source));
      if (family && FAMILY.test(family) && asset) { const font = fonts.find((f) => f.file === asset.path); if (font) font.family = family; }
    }
    writeFileSync(this.file(id, 'extracted.txt'), text.map((f) => `${f.name}\n${f.text}`).join('\n\n').slice(0, 1000000));
    const parsed = parseBrand(text);
    if (fonts.length && !parsed.theme.font) parsed.theme.font = fonts[0].family;
    return this.save({ ...parsed, id, logos, fonts, source, addedAt: new Date().toISOString() });
  }
}

export const brands = new Brands();

export function registerBrands(app: FastifyInstance, store: Store, jobs: Jobs, kits = brands) {
  app.get('/api/brands', async () => kits.list());
  app.get<{ Params: { id: string } }>('/api/brands/:id', async (req) => kits.read(req.params.id));
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/brands/:id', async (req) => {
    const patch = BrandKit.pick({ name: true, theme: true }).partial().strict().parse(req.body);
    return kits.save({ ...kits.read(req.params.id), ...patch });
  });
  app.post('/api/brands', async (req) => {
    const part = await req.file({ limits: { fileSize: MAX_BYTES } });
    if (!part) throw new OpError('choose an identity file');
    const bytes = await part.toBuffer();
    if (part.file.truncated) throw new OpError('identity file larger than 32 MB');
    return kits.upload(part.filename, bytes);
  });
  app.get<{ Params: { id: string; file: string } }>('/api/brands/:id/assets/:file', async (req, reply) => {
    if (!ASSET.test(req.params.file)) throw new OpError('not a brand asset');
    const path = kits.file(req.params.id, `assets/${req.params.file}`);
    const ext = extname(path).toLowerCase();
    const mime: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
    return reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox").type(mime[ext]).send(readFileSync(path));
  });
  app.post<{ Params: { id: string }; Body: { project: string } }>('/api/brands/:id/extract', async (req) => {
    store.get(req.body.project);
    const kit = kits.read(req.params.id);
    if (Object.keys(kit.theme).length >= 3 && !/\.(pdf|png|jpe?g|webp)$/i.test(kit.source)) throw new OpError('local extraction already has enough values');
    const file = kits.file(kit.id, /\.zip$/i.test(kit.source) ? 'extracted.txt' : `original${extname(kit.source).toLowerCase()}`);
    return { job: jobs.add('agent', req.body.project, `قراءة هوية ${kit.source}`, async (ctx) => {
      const result = await runBrandAgent(ctx, req.body.project, file, kit);
      const saved = kits.save({ ...kit, name: result.name || kit.name, theme: result.theme, palette: result.palette, notes: result.notes });
      return { brand: saved };
    }) };
  });
}
