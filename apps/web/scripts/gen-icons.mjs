/* eslint-disable no-console -- this is a CLI dev script; console output is its UI */
// Rasterizes public/icon.svg into the PNG icons the web app manifest references.
// Run after editing icon.svg:  pnpm --filter @pocketverse/web icons
//
// sharp is a devDependency, kept out of the runtime bundle. The generated PNGs
// are committed, so production and CI never need to run this — it's only for
// regenerating icons when the source SVG changes.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const svg = await readFile(join(publicDir, 'icon.svg'));
// The maskable icon has a FLAT background matching the manifest's
// background_color. Android paints the launch splash as this icon on that
// colour, so a flat match makes the icon's tile edge vanish and the mark appear
// to float — with the radial version you can see the squircle sitting on the
// splash. Keep the two in sync if the mark ever changes.
const maskableSvg = await readFile(join(publicDir, 'icon-maskable.svg'));

// `any` icons: transparent-friendly square renders at the requested size.
// `maskable`: identical art (the mark already sits inside the maskable safe
// zone), flagged maskable in the manifest so Android can crop to its shape.
// `apple-touch-icon`: iOS ignores transparency and rounds corners itself, so a
// full-bleed 180px tile is exactly right.
// Several raster sizes so Chrome can pick one matching the device's density
// instead of downscaling a single large icon — a mismatched pick is what makes
// an Android splash look soft or fall back to a generic mark.
const targets = [
  { file: 'icon-192.png', size: 192, src: svg },
  { file: 'icon-256.png', size: 256, src: svg },
  { file: 'icon-384.png', size: 384, src: svg },
  { file: 'icon-512.png', size: 512, src: svg },
  { file: 'icon-maskable-192.png', size: 192, src: maskableSvg },
  { file: 'icon-maskable-512.png', size: 512, src: maskableSvg },
  { file: 'apple-touch-icon.png', size: 180, src: svg },
];

for (const { file, size, src } of targets) {
  await sharp(src, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(join(publicDir, file));
  console.log(`  ✓ ${file} (${size}×${size})`);
}
console.log('Icons regenerated from public/icon.svg');
