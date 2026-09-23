import type { MetadataRoute } from 'next';
import { MANIFEST_BACKGROUND } from '@/lib/theme';

/**
 * Web app manifest — the file that makes Pocketverse installable as a PWA.
 * Next serves this at /manifest.webmanifest and injects <link rel="manifest">
 * automatically. Installation stays entirely opt-in: the manifest only makes
 * the browser *offer* installation, and we suppress the automatic prompt (see
 * pwa-register.tsx) so the single entry point is the button in Settings.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pocketverse',
    short_name: 'Pocketverse',
    description: 'A whole universe in your pocket — your files, in storage you control.',
    // Launch straight into the drive; it redirects to sign-in when needed.
    start_url: '/drive',
    id: '/',
    scope: '/',
    display: 'standalone',
    // Both come from lib/theme. background_color becomes the installed app's
    // window background — on Android 15+ it is what shows behind the
    // (transparent) system bars whenever Chrome doesn't draw the page there,
    // and lib/theme pins theme-color to it in exactly that case.
    background_color: MANIFEST_BACKGROUND,
    theme_color: MANIFEST_BACKGROUND,
    categories: ['productivity', 'utilities'],
    // Raster only, deliberately. Android builds an APK for an installed PWA and
    // draws the splash from these icons — it does not rasterize SVG. Listing
    // `icon.svg` with sizes:"any" invited Chrome to pick it as the best match
    // and then fall back to a generic mark, which is why the installed splash
    // didn't look like the app. The SVG is still the source art and is still
    // used as the browser-tab favicon via layout.tsx.
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
      { src: '/icon-384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Maskable lets Android crop to its own icon shape without clipping the
      // mark — and on Android 12+ it's what the splash animation uses.
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
