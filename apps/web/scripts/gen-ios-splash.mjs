/* eslint-disable no-console -- this is a CLI dev script; console output is its UI */
// Renders the iOS launch images ("apple-touch-startup-image") into public/splash/.
// Run after changing the launch screen or the device list:
//   pnpm --filter @pocketverse/web ios-splash
//
// iOS is the one platform that shows a fully custom image while an installed web
// app starts — but only an exact-size PNG per screen, chosen by media query. We
// render them in Chromium from the same lockup as <AppSplash> (same mark, same
// Space Grotesk wordmark, same colours), so the hand-off from iOS's launch image
// to the app's own launch screen is invisible. Portrait only: installed web apps
// launch in portrait on iPhone, and iOS simply shows no image for an unmatched
// size, which is harmless.
//
// Needs Playwright's Chromium. Set CHROMIUM_PATH to use a specific binary.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'public', 'splash');
const devices = JSON.parse(await readFile(join(root, 'src/lib/ios-splash-devices.json'), 'utf8'));
const require = createRequire(import.meta.url);
const font = pathToFileURL(
  join(
    dirname(require.resolve('@fontsource-variable/space-grotesk/package.json')),
    'files/space-grotesk-latin-wght-normal.woff2',
  ),
).href;
const inter = pathToFileURL(
  join(
    dirname(require.resolve('@fontsource-variable/inter/package.json')),
    'files/inter-latin-wght-normal.woff2',
  ),
).href;

// Mirrors <AppSplash> in dark mode (components/app-splash.tsx + .pv-splash CSS).
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'SG'; src: url('${font}') format('woff2'); font-weight: 300 700; }
@font-face { font-family: 'Inter'; src: url('${inter}') format('woff2'); font-weight: 100 900; }
html, body { margin: 0; height: 100%; background: #070b16; }
body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
  font-family: 'Inter', system-ui, sans-serif; }
.name { font-family: 'SG', system-ui, sans-serif; font-size: 1.6rem; font-weight: 600; letter-spacing: 0.01em;
  background: linear-gradient(120deg, #6d6af8, #9d6af8 55%, #4fd1c5); -webkit-background-clip: text;
  background-clip: text; color: transparent; }
.hint { font-size: 0.85rem; color: #8b93ad; }
</style></head><body>
<svg width="104" height="104" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="72%"><stop offset="0%" stop-color="#161d3a"/>
      <stop offset="60%" stop-color="#0a1022"/><stop offset="100%" stop-color="#070b16"/></radialGradient>
    <linearGradient id="ring" x1="14%" y1="18%" x2="88%" y2="86%"><stop offset="0%" stop-color="#6d6af8"/>
      <stop offset="55%" stop-color="#9d6af8"/><stop offset="100%" stop-color="#4fd1c5"/></linearGradient>
    <radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#eef0ff"/>
      <stop offset="70%" stop-color="#b9b6ff"/><stop offset="100%" stop-color="#8f8bf6"/></radialGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="18" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="512" height="512" rx="116" fill="url(#bg)"/>
  <g transform="translate(256 256)" filter="url(#glow)">
    <ellipse rx="182" ry="80" transform="rotate(-24)" fill="none" stroke="url(#ring)" stroke-width="15"/>
    <circle cx="118" cy="-96" r="26" fill="#4fd1c5"/><circle r="52" fill="url(#core)"/>
  </g>
</svg>
<span class="name">Pocketverse</span>
<span class="hint">Opening your universe…</span>
</body></html>`;

await mkdir(outDir, { recursive: true });
// Loaded from a file (not setContent) so the page may read the local font file.
const pagePath = join(tmpdir(), `pv-ios-splash-${process.pid}.html`);
await writeFile(pagePath, html);
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
for (const d of devices) {
  const page = await browser.newPage({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.ratio,
  });
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const file = `apple-splash-${d.width * d.ratio}x${d.height * d.ratio}.png`;
  await page.screenshot({ path: join(outDir, file) });
  await page.close();
  console.log(`  ✓ ${file}  (${d.name})`);
}
await browser.close();
await rm(pagePath, { force: true });
console.log(`iOS launch images written to public/splash/ (${devices.length})`);
