// Packs electron-builder's win-unpacked folder as Qassa-Portable.zip: extract anywhere, run Qassa.exe, data stays in ./data.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..'), out = join(root, 'artifacts/desktop');
const unpacked = join(out, 'win-unpacked'), stage = join(out, 'portable'), folder = join(stage, 'Qassa');
if (!existsSync(join(unpacked, 'Qassa.exe'))) throw new Error('Run electron-builder --win dir first (npm run dist:portable)');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
rmSync(stage, { recursive: true, force: true });
cpSync(unpacked, folder, { recursive: true });
// main.ts switches to ./data when this marker sits beside Qassa.exe.
writeFileSync(join(folder, 'portable.txt'), `﻿قَصّة ${version} — نسخة محمولة (Portable)

شغّل Qassa.exe مباشرة، بدون تثبيت.
كل بياناتك (المشاريع، الإعدادات، Python ونموذج Whisper) تُحفظ في مجلد data بجانب البرنامج.
لنقل البرنامج إلى جهاز آخر انسخ مجلد Qassa كاملاً مع data.
ضعه في مجلد تملك صلاحية الكتابة فيه (سطح المكتب، المستندات، فلاش) وليس Program Files.
لا تحذف هذا الملف؛ بدونه يحفظ البرنامج بياناته في المستندات\\Qassa.

Windows قد يحذّر لأن البرنامج غير موقّع: More info ثم Run anyway.
`);
const zip = join(out, `Qassa-Portable-${version}.zip`);
rmSync(zip, { force: true });
// Windows' bsdtar writes zip archives much faster than Compress-Archive.
const tar = spawnSync(join(process.env.SystemRoot || 'C:/Windows', 'System32/tar.exe'),['-a', '-c', '-f', zip, '-C', stage, 'Qassa'], { stdio: 'inherit', windowsHide: true });
if (tar.status !== 0) throw new Error('tar failed to create the zip');
rmSync(stage, { recursive: true, force: true });
console.log(`Portable ready: ${zip}`);
