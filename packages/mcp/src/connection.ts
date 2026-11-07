import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function desktopConnection(env: NodeJS.ProcessEnv = process.env, home = homedir()): { base: string; data: string } | undefined {
  if (env.EDIT_PORT && env.EDIT_DESKTOP !== '1') return;
  const data = env.EDIT_DATA_DIR ? resolve(env.EDIT_DATA_DIR) : join(home, 'Documents/Qassa');
  const file = join(data, '.port');
  if (!env.EDIT_DESKTOP && !existsSync(file)) return;
  if (!existsSync(file)) throw new Error('افتح تطبيق قَصّة أولًا؛ لم يُنشئ ملف .port بعد.');
  const value = readFileSync(file, 'utf8').trim();
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('invalid Qassa .port');
  return { base: `http://127.0.0.1:${value}`, data };
}
