import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mixAudioTracks, probeAudioTracks } from '../src/audio-tracks.ts';

/** loudness of one tone (Hz) in the file's first audio track, dB */
const toneDb = (file: string, hz: number) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-map', '0:a:0', '-af', `bandpass=f=${hz}:width_type=q:w=30,volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' });
  return Number(/mean_volume: (-?[\d.]+)/.exec(r.stderr)?.[1] ?? -99);
};

describe('several audio tracks', () => {
  it('mixes the chosen tracks into the first one and keeps every original after it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qassa-tracks-')), file = join(dir, 'rec.mp4');
    try {
      // a recording: picture + mic (440 Hz) + desktop (1000 Hz) + music (2500 Hz) + an empty track
      expect(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=2', ...[440, 1000, 2500].flatMap((f) => ['-f', 'lavfi', '-i', `sine=f=${f}:d=2`]), '-f', 'lavfi', '-i', 'anullsrc=d=2',
        '-map', '0', '-map', '1', '-map', '2', '-map', '3', '-map', '4', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', file]).status).toBe(0);
      expect(probeAudioTracks(file)).toMatchObject({ mixed: false, mix: [0] });
      expect(toneDb(file, 1000)).toBeLessThan(-50); // only the mic plays before

      await mixAudioTracks(file, [0, 1, 2, 3]);
      let info = probeAudioTracks(file);
      expect(info).toMatchObject({ mixed: true, mix: [0, 1, 2, 3] });
      expect(info.tracks).toHaveLength(4);
      for (const hz of [440, 1000, 2500]) expect(toneDb(file, hz)).toBeGreaterThan(-35);

      // only the desktop track: the mix is redone from the kept originals
      await mixAudioTracks(file, [1]);
      info = probeAudioTracks(file);
      expect(info).toMatchObject({ mixed: true, mix: [1] });
      expect(info.tracks).toHaveLength(4);
      expect(toneDb(file, 1000)).toBeGreaterThan(-35);
      expect(toneDb(file, 440)).toBeLessThan(-50);
      // the picture is copied, not re-encoded away
      expect(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim()).toBe('h264');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
});
