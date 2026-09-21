import type { MetadataRoute } from 'next';

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
    background_color: '#070b16',
    theme_color: '#070b16',
    categories: ['productivity', 'utilities'],
    icons: [
      // Scalable source — modern browsers prefer it and it never pixelates.
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Maskable lets Android crop to its own icon shape without clipping the mark.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
