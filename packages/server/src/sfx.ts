import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { FFMPEG } from '@edit/render';
import { SFX, type SfxId } from '@edit/shared';
import { DATA_DIR } from './config.ts';

// The sound-effect library is synthesised with ffmpeg the first time it is needed: no downloads,
// nothing to license. Each recipe is a lavfi source + shaping filters → 48 kHz stereo WAV.

export const SFX_DIR = join(DATA_DIR, 'sfx-lib');
const VERSION = 2; // bump to regenerate after changing a recipe

const sine = (expr: string, d: number) => ['-f', 'lavfi', '-i', `aevalsrc=exprs='${expr}':s=48000:d=${d}`];
const noise = (color: string, d: number, a = 0.5) => ['-f', 'lavfi', '-i', `anoisesrc=d=${d}:c=${color}:a=${a}:r=48000`];

const RECIPES: Record<SfxId, { input: string[]; af: string }> = {
  // air passing: pink noise, band-limited, swelling in then trailing off
  whoosh: { input: noise('pink', 0.75, 0.7), af: 'highpass=f=250,lowpass=f=2600,afade=t=in:d=0.32:curve=exp,afade=t=out:st=0.32:d=0.43:curve=exp,volume=6' },
  swoosh: { input: noise('white', 0.4, 0.5), af: 'highpass=f=1200,lowpass=f=7000,afade=t=in:d=0.12:curve=exp,afade=t=out:st=0.12:d=0.28:curve=exp,volume=3' },
  click: { input: sine('0.9*sin(2*PI*2200*t)*exp(-t*140)+0.4*sin(2*PI*4400*t)*exp(-t*220)', 0.06), af: 'highpass=f=600' },
  // a quick downward pitch sweep with a fast decay
  pop: { input: sine('0.9*sin(2*PI*(950*t-1900*t*t))*exp(-t*26)', 0.2), af: 'afade=t=out:st=0.15:d=0.05' },
  ding: { input: sine('0.55*sin(2*PI*1318.5*t)*exp(-t*3.5)+0.25*sin(2*PI*2637*t)*exp(-t*5.5)+0.12*sin(2*PI*3955.5*t)*exp(-t*8)', 1.4), af: 'afade=t=in:d=0.004' },
  impact: { input: sine('0.95*sin(2*PI*(120*t-55*t*t))*exp(-t*6)+0.25*sin(2*PI*240*t)*exp(-t*14)', 0.8), af: 'lowpass=f=900,afade=t=out:st=0.6:d=0.2' },
  riser: { input: sine('0.5*sin(2*PI*(180*t+260*t*t))*pow(t/1.5,1.6)+0.2*sin(2*PI*(360*t+520*t*t))*pow(t/1.5,2)', 1.5), af: 'afade=t=out:st=1.45:d=0.05' },
  tick: { input: noise('white', 0.03, 0.6), af: 'highpass=f=3000,afade=t=out:d=0.03:curve=exp' },
};

/** Project-independent path of an effect, generated if missing. */
export function sfxFile(id: SfxId): string {
  if (!(id in SFX)) throw new Error(`unknown sound effect ${id}`);
  const file = join(SFX_DIR, `${id}-v${VERSION}.wav`);
  if (existsSync(file)) return file;
  mkdirSync(SFX_DIR, { recursive: true });
  const tmp = file.replace(/\.wav$/, '.part.wav');
  const r = spawnSync(FFMPEG, ['-v', 'error', '-y', ...RECIPES[id].input, '-af', `${RECIPES[id].af},alimiter=limit=0.9:level=false,aformat=sample_fmts=s16:channel_layouts=stereo`, '-ac', '2', tmp], { windowsHide: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`could not make sound effect ${id}: ${r.stderr}`);
  renameSync(tmp, file);
  return file;
}

export const sfxList = () => (Object.keys(SFX) as SfxId[]).map((id) => ({ id, ...SFX[id] }));
