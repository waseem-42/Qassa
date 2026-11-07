import { describe, expect, it } from 'vitest';
import { parseTier, routeByRules, routeNotes, TIERS } from '../src/router.ts';

describe('AI task router', () => {
  it('sends small changes to the quick tier and whole edits to the deep one', () => {
    expect(routeByRules('غيّر لون العنوان للأحمر')?.tier).toBe('quick');
    expect(routeByRules('خل النص أكبر شوي')?.tier).toBe('quick');
    expect(routeByRules('احذف الرسمة اللي في النص')?.tier).toBe('quick');
    expect(routeByRules('حط كابشن للفيديو')?.tier).toBe('standard');
    expect(routeByRules('نفّذ التعليقات')?.tier).toBe('standard');
    expect(routeByRules('مَنتِج المقطع كامل')?.tier).toBe('deep');
    expect(routeByRules('طلّع شورت من الفيديو')?.tier).toBe('deep');
    expect(routeByRules('make a full edit and change the title colour')?.tier).toBe('deep');
  });

  it('a long request with many parts is not quick; no rule means the classifier decides', () => {
    expect(routeByRules('غير النص و بعدين حرك الشعار و ثم كبّر الصورة و احذف آخر لقطة')?.tier).toBe('standard');
    expect(routeByRules('ممم')).toBeUndefined();
    expect(parseTier('Deep.')).toBe('deep');
    expect(parseTier('not sure')).toBe('standard');
  });

  it('every tier is capped and cheaper tiers stay cheaper', () => {
    expect(TIERS.quick.budget).toBeLessThan(TIERS.standard.budget);
    expect(TIERS.standard.budget).toBeLessThan(TIERS.deep.budget);
    for (const t of Object.values(TIERS)) expect(t.estimate[1]).toBeLessThanOrEqual(t.budget);
  });

  it('comments: one small comment is quick, several are at least standard, the heaviest decides', () => {
    expect(routeNotes(['احذف هذا الجزء']).tier).toBe('quick');
    expect(routeNotes(['زوم على الشاشة هنا']).tier).toBe('standard');
    expect(routeNotes(['احذف هذا', 'غيّر اللون']).tier).toBe('standard');
    expect(routeNotes(['احذف هذا', 'صمّم رسمة جديدة للمقارنة']).tier).toBe('deep');
  });
});
