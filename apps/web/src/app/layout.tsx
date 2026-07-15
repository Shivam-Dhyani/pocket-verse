import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import { Analytics } from '@/components/analytics';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pocketverse',
  description: 'A whole universe in your pocket — your files, in storage you control.',
};

/** Runs before paint so a stored light-mode choice never flashes dark. */
const themeInit = `try{var t=localStorage.getItem('pv-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

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
