import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const root = resolve(import.meta.dirname, '..'), out = join(root, 'packages/desktop/resources');
mkdirSync(out, { recursive: true }); mkdirSync(join(root, 'artifacts/desktop-deps'), { recursive: true });
const banner = "import { createRequire as __createRequire } from 'node:module'; var require = __createRequire(import.meta.url);";
for (const name of ['server', 'mcp']) await build({ entryPoints: [join(root, `packages/${name}/src/index.ts`)], outfile: join(out, `${name}.mjs`), bundle: true, platform: 'node', format: 'esm', target: 'node22', banner: { js: banner }, logLevel: 'warning' });
await build({ entryPoints: [join(root, 'packages/desktop/src/main.ts')], outfile: join(root, 'packages/desktop/dist/main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node22' });
for (const dir of ['analysis', 'graphics-lib', 'style-library']) cpSync(join(root, dir), join(out, dir), { recursive: true, filter: (p) => !p.includes('__pycache__') && !p.endsWith('.pyc') });
cpSync(join(root, 'packages/app/dist'), join(out, 'packages/app/dist'), { recursive: true });
cpSync(join(root, 'packages/desktop/supervisor.ps1'), join(out, 'supervisor.ps1'));
writeFileSync(join(out, 'agent-instructions.md'), `${readFileSync(join(root, 'CLAUDE.md'), 'utf8')}\n\n${readFileSync(join(root, '.claude/skills/edit-tool/SKILL.md'), 'utf8')}`);
const desktopPackage = join(root, 'packages/desktop/package.json');
writeFileSync(desktopPackage, `${JSON.stringify({ ...JSON.parse(readFileSync(desktopPackage, 'utf8')), version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version }, null, 2)}\n`);
// Ship only built-in fonts, never the developer's saved brand kits.
const fonts = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import {fontFiles} from './packages/server/src/textimg.ts';console.log(JSON.stringify(fontFiles().filter(f=>f.file.includes('node_modules'))))"], { cwd: root, encoding: 'utf8', windowsHide: true });
if (fonts.status !== 0) throw new Error(fonts.stderr);
mkdirSync(join(out, 'fonts'), { recursive: true }); mkdirSync(join(out, 'licenses'), { recursive: true });
const manifest = JSON.parse(fonts.stdout).map((f) => { const file = basename(f.file), pkg = dirname(dirname(f.file)); cpSync(f.file, join(out, 'fonts', file)); if (existsSync(join(pkg, 'LICENSE'))) cpSync(join(pkg, 'LICENSE'), join(out, 'licenses', `font-${basename(pkg)}-LICENSE`)); return { ...f, file }; });
writeFileSync(join(out, 'fonts/manifest.json'), JSON.stringify(manifest));
if (process.argv.includes('--code-only')) process.exit(0);

// Download a static GPL build including NVENC; retain its notice and corresponding source.
const deps = join(root, 'artifacts/desktop-deps'), zip = join(deps, 'ffmpeg.zip'), source = join(deps, 'ffmpeg-source.tar.gz');
async function download(url, file) {
  if (existsSync(file)) return;
  const part = `${file}.part`; let offset = existsSync(part) ? statSync(part).size : 0;
  console.log(`Downloading ${url} (resume ${Math.round(offset / 1024 ** 2)} MB)`);
  const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
  const total = Number(head.headers.get('content-length')); if (!head.ok) throw new Error(`Download failed: ${url}`);
  if (!total) { const response = await fetch(head.url, { signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error(`Download failed: ${url}`); writeFileSync(part, Buffer.from(await response.arrayBuffer())); renameSync(part, file); return; }
  // Small ranged requests also work behind proxies which buffer large responses.
  while (offset < total) {
    const chunks = Array.from({ length: Math.min(4, Math.ceil((total - offset) / 1048576)) }, (_, i) => ({ start: offset + i * 1048576, end: Math.min(total - 1, offset + (i + 1) * 1048576 - 1) }));
    const results = await Promise.allSettled(chunks.map(async ({ start, end }) => {
      const response = await fetch(head.url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(45000) });
      if (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${start}-`)) throw new Error(`Range unsupported: ${head.url}`);
      const body = Buffer.from(await response.arrayBuffer()); if (body.length !== end - start + 1) throw new Error('Incomplete download chunk'); return body;
    }));
    for (const result of results) { if (result.status === 'rejected') throw result.reason; appendFileSync(part, result.value); offset += result.value.length; }
    console.log(`${basename(file)}: ${Math.round(offset / 1024 ** 2)} / ${Math.round(total / 1024 ** 2)} MB`);
  }
  renameSync(part, file);
}
const ffmpegVersion = '9.0.2', checksum = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba';
await download(`https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-${ffmpegVersion}-essentials_build.zip`, zip);
if (createHash('sha256').update(readFileSync(zip)).digest('hex') !== checksum) throw new Error('FFmpeg checksum differs; remove artifacts/desktop-deps/ffmpeg.zip and retry');
const unpack = join(deps, 'ffmpeg');
if (!existsSync(unpack)) {
  const q = (s) => `'${s.replaceAll("'", "''")}'`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(unpack)} -Force`], { windowsHide: true, encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr);
}
const ffroot = join(unpack, readdirSync(unpack)[0]); mkdirSync(join(out, 'bin'), { recursive: true }); mkdirSync(join(out, 'licenses'), { recursive: true });
for (const file of ['ffmpeg.exe', 'ffprobe.exe']) cpSync(join(ffroot, 'bin', file), join(out, 'bin', file));
for (const file of ['LICENSE', 'README.txt']) if (existsSync(join(ffroot, file))) cpSync(join(ffroot, file), join(out, 'licenses', `ffmpeg-${file}`));
const version = spawnSync(join(out, 'bin/ffmpeg.exe'), ['-version'], { encoding: 'utf8', windowsHide: true }).stdout;
const release = version.match(/ffmpeg version (\d+\.\d+(?:\.\d+)?)/)?.[1]; if (!release) throw new Error('Unknown FFmpeg release');
if (release !== ffmpegVersion) throw new Error('Cached FFmpeg version differs from the pinned build; clear artifacts/desktop-deps');
const sourceUrl = `https://codeload.github.com/FFmpeg/FFmpeg/tar.gz/refs/tags/n${release}`; await download(sourceUrl, source); cpSync(source, join(out, 'licenses', `ffmpeg-${release}-source.tar.gz`));
writeFileSync(join(out, 'licenses/FFmpeg-NOTICE.txt'), `FFmpeg ${release}\nStatic GPL build by Gyan Doshi: https://www.gyan.dev/ffmpeg/builds/\nBinary SHA256: ${checksum}\nCorresponding FFmpeg source bundled alongside this notice; upstream: ${sourceUrl}\nFull build configuration:\n${version}\nThis distribution includes GPL components (libx264/libx265 etc). Their upstream source and licences must accompany a public release; see docs/desktop.md release checklist.\n`);

if (!existsSync(join(out, 'qassa.ico'))) {
  const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true });
  try { const page = await browser.newPage(); await page.setViewport({ width: 256, height: 256 }); const svg = readFileSync(join(root, 'brand/qassa-app-icon.svg'), 'utf8'); await page.setContent(`<style>*{margin:0}svg{width:256px;height:256px}</style>${svg}`); const png = Buffer.from(await page.screenshot({ omitBackground: true })); const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18); writeFileSync(join(out, 'qassa.ico'), Buffer.concat([header, png])); } finally { await browser.close(); }
}
console.log(`Desktop resources ready (${manifest.length} font files); FFmpeg ${release}, sha256 verified.`);
