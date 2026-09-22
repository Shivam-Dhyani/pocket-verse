'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { applyTheme, storedTheme } from '@/lib/theme';
import { DialogsProvider } from '@/components/dialogs';
import { OfflineBanner } from '@/components/offline-banner';
import { PwaRegister } from '@/components/pwa-register';

/**
 * Re-asserts the theme (and with it the status-bar colour) at app root. The
 * toggle lives in the header, which isn't rendered on the launch screen or the
 * signed-out pages — so relying on it alone left those screens' browser chrome
 * on whatever colour was last set.
 */
function ThemeSync() {
  useEffect(() => {
    applyTheme(storedTheme());
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: true },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <PwaRegister />
      <OfflineBanner />
      <DialogsProvider>{children}</DialogsProvider>
    </QueryClientProvider>
  );
}
