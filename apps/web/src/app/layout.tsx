import type { Metadata, Viewport } from 'next';
import { Suspense, type ReactNode } from 'react';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import { Analytics } from '@/components/analytics';
import { Providers } from '@/components/providers';
import { FORCED_THEME, THEME_COLORS, THEME_PREF_KEY } from '@/lib/theme';
import iosSplashDevices from '@/lib/ios-splash-devices.json';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pocketverse',
  description: 'A whole universe in your pocket — your files, in storage you control.',
  applicationName: 'Pocketverse',
  // Next auto-links app/manifest.ts, but being explicit is harmless and clear.
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  // Lets iOS launch Pocketverse full-screen when added to the home screen.
  appleWebApp: {
    capable: true,
    title: 'Pocketverse',
    statusBarStyle: 'black-translucent',
    // iOS shows these while the installed app starts — the one platform that
    // allows a custom launch image, but only an exact-size PNG per screen.
    // Rendered from the same lockup as <AppSplash> (scripts/gen-ios-splash.mjs).
    startupImage: iosSplashDevices.map((d) => ({
      url: `/splash/apple-splash-${d.width * d.ratio}x${d.height * d.ratio}.png`,
      media: `(device-width: ${d.width}px) and (device-height: ${d.height}px) and (-webkit-device-pixel-ratio: ${d.ratio}) and (orientation: portrait)`,
    })),
  },
};

export const viewport: Viewport = {
  // The app's default (dark) colour; applyTheme() repaints this at runtime.
  themeColor: THEME_COLORS.dark,
  // Edge-to-edge. On Android 15+ the status and navigation bars are
  // transparent and the OS ignores requests to colour them — the only way the
  // page can colour those strips is to draw underneath them. `cover` lets the
  // page extend there; body padding in globals.css keeps content inside the
  // safe area, and body::before paints the theme colour under the status bar.
  // (It was briefly removed on the mistaken theory that it caused the dark
  // bands; without it those bands can only ever be the fixed manifest colour.)
  viewportFit: 'cover',
  // Tells the browser (and any forced/auto dark mode) which schemes the page
  // supports, so nothing tries to recolour a locked dark app.
  colorScheme: FORCED_THEME ?? 'dark light',
};

/**
 * Runs before paint so the right theme is on screen from the first frame — the
 * locked theme (FORCED_THEME) if set, else the stored choice, or the phone's own setting when the choice is 'system' (the
 * default) — and sets `theme-color` to match. In the installed Android app that
 * tag is what the navigation bar follows (Chrome 153+), so it must always be the
 * app's own theme colour. Colours come from lib/theme so this can't drift.
 */
const themeInit = `try{var f=${FORCED_THEME ? `'${FORCED_THEME}'` : 'null'};var p=localStorage.getItem('${THEME_PREF_KEY}');var t=f||(p==='light'||p==='dark'?p:(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'));document.documentElement.dataset.theme=t;var c=t==='light'?'${THEME_COLORS.light}':'${THEME_COLORS.dark}';var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].remove();var n=document.createElement('meta');n.name='theme-color';n.content=c;document.head.appendChild(n)}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
