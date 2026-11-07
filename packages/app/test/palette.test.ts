import { expect, it } from 'vitest';
import { fold, score } from '../src/lib/palette.ts';

it('folds Arabic spelling variants and tashkeel', () => {
  expect(fold('إضافة  نصٍّ')).toBe('اضافه نص');
  expect(fold('مُستوى')).toBe('مستوي');
});

it('ranks an exact word above a longer word and above an al- prefixed word', () => {
  const cut = score('قص عند المؤشر', 'قص'), prev = score('القصة اللي قبل', 'قص'), longer = score('قصاصة', 'قص');
  expect(cut).toBeGreaterThan(longer);
  expect(longer).toBeGreaterThan(prev);
  expect(prev).toBeGreaterThan(0);
  expect(score('تصدير الفيديو', 'اصدار')).toBe(0);
  expect(score('تصدير الفيديو export', 'EXP')).toBeGreaterThan(0);
  // every word has to match
  expect(score('قص عند المؤشر', 'قص نص')).toBe(0);
  expect(score('أي شي', '  ')).toBe(1);
});
