import { describe, expect, it } from 'vitest';
import { applyOps, Op, Project } from '../src/index.ts';

describe('project brand kit', () => {
  it('applies brand and theme together through settings without mutating the original', () => {
    const p = Project.parse({ name: 'test', createdAt: '2026-10-30' });
    const brand = '12345678-1234-4234-8234-123456789abc';
    const next = applyOps(p, [{ op: 'set_settings', patch: { brand, theme: { accent: '#aabbcc' } } }]);
    expect(next.settings.brand).toBe(brand); expect(next.settings.theme.accent).toBe('#aabbcc');
    expect(p.settings.brand).toBeUndefined(); expect(next.settings.theme.font).toBe(p.settings.theme.font);
    expect(Op.safeParse({ op: 'set_settings', patch: { brand: '../invalid' } }).success).toBe(false);
  });
});
