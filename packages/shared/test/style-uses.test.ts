import { expect, it } from 'vitest';
import { STYLE_USES, styleTitleOf, styleUseOf } from '../src/index.ts';

const entry = (over: Partial<{ source: string; category: string; tags: string[]; title: string; description: string }>) => ({ source: 'hyperframes', category: 'hyperframes:block', tags: [], title: 'X', description: '', ...over });

it('sorts entries by what they are for, not where they came from', () => {
  expect(styleUseOf(entry({ source: 'lemo', category: 'Graphic & Type' }))).toBe('looks');
  expect(styleUseOf(entry({ tags: ['lower-third'] }))).toBe('titles');
  expect(styleUseOf(entry({ tags: ['transition'] }))).toBe('transitions');
  expect(styleUseOf(entry({ source: 'awesome', category: 'interactive' }))).toBe('lab');
  expect(styleUseOf(entry({ source: 'awesome', category: 'motion', description: 'An animated bar chart of revenue' }))).toBe('data');
  // "graphic" is not a graph
  expect(styleUseOf(entry({ source: 'awesome', category: 'motion', description: 'Know how good a graphic designer you are' }))).not.toBe('data');
  expect(STYLE_USES.filter((u) => u.hidden).map((u) => u.id)).toEqual(['lab', 'workflows']);
});

it('gives prompt entries a readable title and keeps their author apart', () => {
  expect(styleTitleOf({ source: 'awesome', title: 'moritz · moritz-466494', description: 'I want you to create a highly professional SaaS product launch video. Go and find some.' }))
    .toEqual({ title: 'Highly professional SaaS product launch video', author: 'moritz' });
  expect(styleTitleOf({ source: 'awesome', title: 'a · b', description: 'Adopt the role of an expert motion designer.' }).title).toBe('Adopt the role of an expert motion designer');
  expect(styleTitleOf({ source: 'lemo', title: 'Art Deco', description: 'A grand hotel' })).toEqual({ title: 'Art Deco' });
});
