import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { ANALYSIS_DIR, PYTHON } from '../src/config.ts';

it('supplements energy silence suggestions with padded transcript gaps without duplicates', () => {
  const result = spawnSync(PYTHON, ['-m', 'unittest', 'test_suggestions'], { cwd: ANALYSIS_DIR, encoding: 'utf8', timeout: 20000, windowsHide: true });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}, 25000);
