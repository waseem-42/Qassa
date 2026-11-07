import { lstatSync, realpathSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { OpError } from '@edit/shared';

const SAFE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,63}$/u;

export class ProjectManagementError extends Error {
  constructor(message: string, public readonly statusCode: number) { super(message); }
}

export function assertWithin(root: string, target: string): void {
  const rel = relative(resolve(root), resolve(target));
  if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
    throw new OpError('unsafe project path');
  }
}

/** lstat also catches dangling links; realpath catches junctions in ancestors. */
export function assertNoLink(path: string): void {
  let stat;
  try { stat = lstatSync(path); }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; throw err; }
  if (stat.isSymbolicLink() || relative(resolve(path), realpathSync(path)) !== '') {
    throw new OpError('symbolic links and junctions are not allowed for project management');
  }
}

export function checkedProjectDir(root: string, name: string): string {
  if (!SAFE_NAME.test(name) || name.includes('..') || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new OpError(`invalid project name: ${name}`);
  }
  const dir = resolve(root, name);
  assertWithin(root, dir);
  assertNoLink(root);
  assertNoLink(dir);
  assertNoLink(join(dir, 'project.json'));
  return dir;
}

/** Never traverse an untrusted symlink when moving a project or trash payload. */
export function assertSafeTree(root: string, path: string): void {
  assertWithin(root, path);
  assertNoLink(path);
  const stat = lstatSync(path);
  if (stat.isDirectory()) for (const child of readdirSync(path)) assertSafeTree(root, join(path, child));
}
