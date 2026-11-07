import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function lutCachePath(text: string, mix: number): string {
  return `cache/luts/${createHash('sha1').update(text).update(mix.toFixed(3)).digest('hex').slice(0, 16)}.cube`;
}

/**
 * A LUT with its strength baked in: identity·(1−mix) + LUT·mix at every grid point.
 * Trilinear interpolation of that equals mixing after interpolation, so the render matches
 * the preview shader's mix() exactly, in one lut3d pass instead of split+lut3d+blend.
 */
export function bakedLut(projectDir: string, lut: string, mix: number): string {
  const src = join(projectDir, lut);
  const text = readFileSync(src, 'utf8');
  const rel = lutCachePath(text, mix);
  const dest = join(projectDir, rel);
  if (existsSync(dest)) return rel;

  let size = 0;
  const header: string[] = [];
  const rows: number[][] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^[-\d.]/.test(line)) rows.push(line.split(/\s+/).map(Number));
    else {
      if (line.startsWith('LUT_3D_SIZE')) size = Number(line.split(/\s+/)[1]);
      if (!line.startsWith('TITLE')) header.push(line);
    }
  }
  if (!size || rows.length !== size ** 3) throw new Error(`cannot bake ${lut}: not a 3D .cube`);
  const out = rows.map((v, i) => {
    // .cube order: red changes fastest
    const id = [i % size, Math.floor(i / size) % size, Math.floor(i / size / size)].map((k) => k / (size - 1));
    return v.map((x, c) => (id[c] * (1 - mix) + x * mix).toFixed(6)).join(' ');
  });
  mkdirSync(join(projectDir, 'cache/luts'), { recursive: true });
  writeFileSync(dest, [`TITLE "${lut} @ ${Math.round(mix * 100)}%"`, ...header, ...out].join('\n') + '\n', 'utf8');
  return rel;
}

/** Transparent full-frame PNG used between static text images. */
export function blankImage(projectDir: string, W: number, H: number): string {
  const rel = `cache/text/blank-${W}x${H}.png`;
  const abs = join(projectDir, rel);
  if (!existsSync(abs)) {
    mkdirSync(join(projectDir, 'cache/text'), { recursive: true });
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black@0.0:s=${W}x${H},format=rgba`, '-frames:v', '1', abs]);
    if (r.status !== 0) throw new Error(`could not make blank frame: ${r.stderr}`);
  }
  return rel;
}
