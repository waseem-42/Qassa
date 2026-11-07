import { type Media, type Op } from '@edit/shared';

/** Source bounds stay in source seconds; only overlay placement uses timeline time. */
export function sourceRangeOp(media: Media, from: number, to: number, trackId: string, at: number): Extract<Op, { op: 'add_clip' }> {
  if (![from, to, at, media.duration].every(Number.isFinite) || from < 0 || to > media.duration || to - from < 1 / 60 || at < 0) {
    throw new Error('حدّد بداية ونهاية صالحتين داخل مدة الملف.');
  }
  if (media.kind !== 'video') throw new Error('اختيار الجزء متاح لملفات الفيديو.');
  return { op: 'add_clip', clip: { trackId, mediaId: media.id, in: from, out: to, ...(trackId !== 'V1' ? { start: at } : {}) } };
}
