import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.EDIT_RESOURCES_DIR ? resolve(process.env.EDIT_RESOURCES_DIR) : resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const DATA_DIR = process.env.EDIT_DATA_DIR ? resolve(process.env.EDIT_DATA_DIR) : ROOT;
export const DESKTOP = process.env.EDIT_DESKTOP === '1';
export const PROJECTS_DIR = process.env.EDIT_PROJECTS_DIR ? resolve(process.env.EDIT_PROJECTS_DIR) : join(DATA_DIR, 'projects');
export const PORT = Number(process.env.EDIT_PORT || 4317);
export const ANALYSIS_DIR = join(ROOT, 'analysis');
export const GRAPHICS_LIB_DIR = join(ROOT, 'graphics-lib');

const venvPy = join(ROOT, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export const PYTHON = process.env.EDIT_PYTHON || (DESKTOP ? join(DATA_DIR, 'runtime/python/python.exe') : existsSync(venvPy) ? venvPy : 'python');

export const WHISPER_MODEL = process.env.EDIT_WHISPER_MODEL || (DESKTOP ? join(DATA_DIR, 'runtime/model') : 'large-v3');
export const LANGUAGE = process.env.EDIT_LANGUAGE || 'ar';

export const BROWSER = [
  process.env.EDIT_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe')] : []),
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p));

export const APP_DIST = join(ROOT, 'packages/app/dist');
