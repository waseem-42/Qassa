import { describe, expect, it } from 'vitest';
import { lastProgress } from '../src/agent.ts';

describe('AI task progress lines', () => {
  it('takes the last [[N%]] line and its stage', () => {
    expect(lastProgress('الخطة\n[[10%]] قراءة الكلام\nبعدها\n[[ 45 % ]] قص السكتات')).toEqual({ pct: 45, stage: 'قص السكتات' });
  });
  it('ignores text without one and caps at 99 until the task really ends', () => {
    expect(lastProgress('قصيت السكتات')).toBeUndefined();
    expect(lastProgress('[[100]] خلصت')).toEqual({ pct: 99, stage: 'خلصت' });
  });
});
