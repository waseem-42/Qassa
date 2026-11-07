import { z } from 'zod';
import { CAPTION_TRACK } from './captions.ts';
import { Aspect, type Project } from './schema.ts';
import { clipDuration, projectDuration } from './timeline.ts';

/**
 * How one export differs from the project: size, frame rate, encoding, a part of the timeline,
 * audio only, captions. Nothing here changes the edit — the render works on a copy.
 */
export const ExportSettings = z.object({
  aspect: Aspect.optional(), // another frame shape than the project's (clips are re-framed to fill it)
  resolution: z.number().int().min(240).max(4320).optional(), // short edge, like settings.resolution
  fps: z.number().min(1).max(120).optional(),
  level: z.enum(['small', 'balanced', 'high']).default('balanced'), // file size vs. quality
  codec: z.enum(['h264', 'h265']).default('h264'),
  format: z.enum(['mp4', 'mov', 'mp3', 'wav']).default('mp4'), // mp3/wav = sound only
  range: z.tuple([z.number().min(0), z.number().min(0)]).optional(), // timeline seconds [from, to]
  captions: z.enum(['burn', 'srt', 'both', 'none']).default('burn'), // the caption track: in the picture and/or as an .srt beside it
  fileName: z.string().max(120).optional(), // without extension; made unique in renders/
});
export type ExportSettings = z.infer<typeof ExportSettings>;

export const isAudioFormat = (format: ExportSettings['format']) => format === 'mp3' || format === 'wav';

export interface ExportPreset { id: string; name: string; hint: string; quality: 'preview' | 'final'; settings: Partial<ExportSettings> }

/** Starting points in the export window; every field stays editable after picking one. */
export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'project', name: 'إعدادات المشروع', hint: 'نفس مقاس ودقة المشروع', quality: 'final', settings: {} },
  { id: 'youtube', name: 'يوتيوب', hint: '16:9 · 1080p', quality: 'final', settings: { aspect: '16:9', resolution: 1080, codec: 'h264', format: 'mp4', level: 'high' } },
  { id: 'shorts', name: 'تيك توك · ريلز · شورتس', hint: '9:16 · 1080p', quality: 'final', settings: { aspect: '9:16', resolution: 1080, fps: 30, codec: 'h264', format: 'mp4', level: 'balanced' } },
  { id: 'instagram', name: 'إنستقرام', hint: '4:5 · 1080p', quality: 'final', settings: { aspect: '4:5', resolution: 1080, codec: 'h264', format: 'mp4', level: 'balanced' } },
  { id: '4k', name: '4K', hint: '2160p · H.265', quality: 'final', settings: { resolution: 2160, codec: 'h265', format: 'mp4', level: 'high' } },
  { id: 'review', name: 'مراجعة سريعة', hint: '720p · ملف صغير', quality: 'preview', settings: { level: 'small' } },
  { id: 'audio', name: 'صوت فقط', hint: 'MP3', quality: 'final', settings: { format: 'mp3', captions: 'none' } },
];

/** The part of the timeline an export covers, clamped to the edit; null when it's empty. */
export function exportRange(p: Project, e: Pick<ExportSettings, 'range'>): [number, number] | null {
  const total = projectDuration(p);
  if (!e.range) return total > 0 ? [0, total] : null;
  const t0 = Math.max(0, Math.min(e.range[0], total)), t1 = Math.max(0, Math.min(e.range[1], total));
  return t1 - t0 >= 0.1 ? [t0, t1] : null;
}

const srtTime = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const pad = (x: number, w = 2) => String(x).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

/** The caption track as SubRip, timed from the start of the exported range. Empty when there are no captions. */
export function captionsSrt(p: Project, range: [number, number]): string {
  const [t0, t1] = range;
  const cues = p.clips
    .filter((c) => c.trackId === CAPTION_TRACK && c.text?.trim())
    .map((c) => ({ a: Math.max(c.start, t0), b: Math.min(c.start + clipDuration(c), t1), text: c.text!.trim() }))
    .filter((c) => c.b - c.a > 0.05)
    .sort((x, y) => x.a - y.a);
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.a - t0)} --> ${srtTime(c.b - t0)}\n${c.text}\n`).join('\n');
}

/** A file name a user typed, made safe for Windows and the renders/ folder (no extension). */
export function exportBaseName(name: string | undefined, fallback: string): string {
  const clean = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/u, '').slice(0, 100).trim();
  const out = clean(name ?? '') || clean(fallback) || 'export';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(out) ? `${out}-export` : out;
}
