import { expect, it } from 'vitest';
import { applyOps, defaultTracks, Project } from '../src/index.ts';

const fixture = () => Project.parse({ name: 'text-place', createdAt: '', tracks: defaultTracks() });
const added = (style?: object, text = 'حاسة السمع') => applyOps(fixture(), [{ op: 'add_text', text, start: 0, duration: 3, style }]).clips[0].textStyle!;

it('puts a lower third low on the side its text starts from when no place is given', () => {
  expect(added({ preset: 'lower-third' })).toMatchObject({ x: 0.92, y: 0.82, align: 'start' });
  expect(added({ preset: 'lower-third' }, 'Hearing')).toMatchObject({ x: 0.08, y: 0.82, align: 'start' });
  expect(added({ preset: 'label' })).toMatchObject({ x: 0.5, y: 0.14 });
  expect(added()).toMatchObject({ x: 0.5, y: 0.5, align: 'center' });
});

it('keeps any place the caller gives', () => {
  expect(added({ preset: 'lower-third', y: 0.3 })).toMatchObject({ x: 0.92, y: 0.3, align: 'start' });
  expect(added({ preset: 'lower-third', x: 0.5, align: 'center' })).toMatchObject({ x: 0.5, y: 0.82, align: 'center' });
});
