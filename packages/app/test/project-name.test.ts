import { expect, it } from 'vitest';
import { projectName } from '../src/lib/project-name.ts';

it('keeps spaces and punctuation in the title while making a safe folder for creation and file drops', () => {
  expect(projectName('مراجعة فيديو', [])).toEqual({ name: 'مراجعة-فيديو', displayName: 'مراجعة فيديو' });
  expect(projectName('إعلان: الحلقة / 2', [])).toEqual({ name: 'إعلان-الحلقة-2', displayName: 'إعلان: الحلقة / 2' });
  expect(projectName('My video', ['my-video'])).toEqual({ name: 'My-video-2', displayName: 'My video' });
  expect(projectName('clip', [])).toEqual({ name: 'clip', displayName: undefined });
});
