import type { Metadata, Viewport } from 'next';
import { Suspense, type ReactNode } from 'react';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import { Analytics } from '@/components/analytics';
import { Providers } from '@/components/providers';
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
  },
};

export const viewport: Viewport = {
  // Matches the app's dark background so the status/URL bar blends in.
  themeColor: '#070b16',
  // Draw under the iOS notch/home indicator when running installed.
  viewportFit: 'cover',
};

/**
 * Runs before paint so a stored light-mode choice never flashes dark — and
 * repaints `theme-color` at the same time, which is what the phone's status bar
 * and the PWA's title bar follow. Without that second line those bars stay dark
 * in light mode, since the manifest's theme_color is a single fixed value.
 */
const themeInit = `try{var t=localStorage.getItem('pv-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='light'?'#f4f6fc':'#070b16')}}catch(e){}`;

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
