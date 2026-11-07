import { expect, it } from 'vitest';
import { uploadError } from '../src/lib/upload-error.ts';

it('explains a broken file in Arabic and keeps the raw ffprobe text as details', () => {
  const raw = 'ffprobe failed for e8ec465c.mp4: [mov,mp4,m4a,3gp,3g2,mj2 @ 0000] moov atom not found D:/x/source/e8ec465c.mp4: Invalid data found when processing input';
  const e = uploadError(raw);
  expect(e.text).toMatch(/تالفًا/);
  expect(e.text).not.toMatch(/ffprobe|e8ec465c/);
  expect(e.details).toBe(raw);
});

it('passes other messages through unchanged', () => {
  expect(uploadError('الملف أكبر من المسموح')).toEqual({ text: 'الملف أكبر من المسموح' });
  expect(uploadError()).toEqual({ text: 'تعذّر رفع الملف.' });
});
