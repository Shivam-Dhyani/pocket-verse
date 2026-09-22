'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { DialogsProvider } from '@/components/dialogs';
import { OfflineBanner } from '@/components/offline-banner';
import { PwaRegister } from '@/components/pwa-register';

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
      <PwaRegister />
      <OfflineBanner />
      <DialogsProvider>{children}</DialogsProvider>
    </QueryClientProvider>
  );
}
