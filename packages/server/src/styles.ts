import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { CAPTION_TRACK, MAIN_TRACK, STYLE_PRESETS, type Project, type StyleDef } from '@edit/shared';
import { DATA_DIR } from './config.ts';

// Saved styles: a project's look kept outside any project (styles/<id>/style.json, plus its LUT)
// so it can be applied to the next one. The built-in library lives in @edit/shared.

export const STYLES_DIR = join(DATA_DIR, 'styles');

export interface SavedStyle extends StyleDef { saved: true; createdAt: string; from?: string; lutFile?: string }

export function savedStyles(): SavedStyle[] {
  if (!existsSync(STYLES_DIR)) return [];
  return readdirSync(STYLES_DIR, { withFileTypes: true }).flatMap((d) => {
    const f = join(STYLES_DIR, d.name, 'style.json');
    if (!d.isDirectory() || !existsSync(f)) return [];
    try { return [JSON.parse(readFileSync(f, 'utf8')) as SavedStyle]; } catch { return []; }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const slug = (s: string) => {
  const value = s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40).replace(/^-|-$/g, '') || 'style';
  // These names are reserved as directories on Windows.
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value) ? `style-${value}` : value;
};

/** Keep the project's current look (theme, default grade + its LUT, caption style, the most used transition) as a style. */
export function saveStyle(p: Project, projectDir: string, name: string, description = ''): SavedStyle {
  let id = slug(name);
  for (let i = 2; existsSync(join(STYLES_DIR, id)) || STYLE_PRESETS.some((s) => s.id === id); i++) id = `${slug(name)}-${i}`;
  const dir = join(STYLES_DIR, id);
  mkdirSync(dir, { recursive: true });
  const g = p.settings.defaultGrade;
  let lutFile: string | undefined;
  if (g?.lut && existsSync(join(projectDir, g.lut))) {
    lutFile = basename(g.lut);
    copyFileSync(join(projectDir, g.lut), join(dir, lutFile));
  }
  const grade = g ? Object.fromEntries(Object.entries(g).filter(([k]) => k !== 'lut')) : undefined;
  const capClip = p.clips.find((c) => c.trackId === CAPTION_TRACK && c.textStyle);
  const captionSource = p.settings.captionStyle ?? capClip?.textStyle;
  const captions = captionSource ? { ...captionSource } : undefined;
  if (captions) for (const k of ['x', 'align', 'animation', 'preset'] as const) delete (captions as Record<string, unknown>)[k];
  const counts = new Map<string, { n: number; t: NonNullable<Project['clips'][number]['transition']> }>();
  for (const c of p.clips) if (c.trackId === MAIN_TRACK && c.transition) {
    const k = c.transition.kind;
    counts.set(k, { n: (counts.get(k)?.n ?? 0) + 1, t: c.transition });
  }
  const transition = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.t;
  const style: SavedStyle = {
    saved: true, id, name: name.trim(), description: description.trim() || `من مشروع ${p.name}`, from: p.name, createdAt: new Date().toISOString(),
    theme: { ...p.settings.theme }, grade, captions, transition: transition ? { ...transition } : undefined, lutFile,
  };
  writeFileSync(join(dir, 'style.json'), JSON.stringify(style, null, 2), 'utf8');
  return style;
}

export function deleteStyle(id: string): boolean {
  if (!/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(id)) return false;
  const dir = resolve(STYLES_DIR, id);
  if (dirname(dir) !== resolve(STYLES_DIR) || !existsSync(join(dir, 'style.json'))) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** A style by id (built-in or saved); a saved style's LUT is copied into the project and its path returned. */
export function resolveStyle(id: string, projectDir: string): { style: StyleDef; lut?: string } | undefined {
  const preset = STYLE_PRESETS.find((s) => s.id === id);
  if (preset) return { style: preset };
  const saved = savedStyles().find((s) => s.id === id);
  if (!saved) return undefined;
  let lut: string | undefined;
  if (saved.lutFile && existsSync(join(STYLES_DIR, saved.id, saved.lutFile))) {
    mkdirSync(join(projectDir, 'luts'), { recursive: true });
    lut = `luts/style-${saved.id}-${saved.lutFile}`;
    copyFileSync(join(STYLES_DIR, saved.id, saved.lutFile), join(projectDir, lut));
  }
  return { style: saved, lut };
}
