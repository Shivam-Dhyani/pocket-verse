'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { hasSessionHint, setSessionHint, useAuthStore } from '@/stores/auth';

/**
 * Forward signed-in users to /drive with a history REPLACE. Used on the
 * landing, login, and register pages so that once someone is signed in, /drive
 * behaves as the bottom of the back stack: pressing Back lands on one of these
 * pages, which immediately replaces itself with /drive again.
 *
 * Fast path: an access token in memory (client-side nav) redirects instantly.
 * Reload path: no token in memory, but the session hint says this browser has
 * an httpOnly refresh cookie — try one silent refresh, and only redirect if it
 * succeeds. Visitors with no hint skip the network round-trip entirely.
 */
export function useForwardIfAuthed(): void {
  const router = useRouter();
  useEffect(() => {
    if (useAuthStore.getState().accessToken) {
      router.replace('/drive');
      return;
    }
    if (!hasSessionHint()) {
      return;
    }
    let cancelled = false;
    void api.refresh().then((ok) => {
      if (ok && !cancelled) {
        router.replace('/drive');
      } else if (!ok) {
        // The cookie is gone or expired — drop the hint so future visits
        // don't keep probing.
        setSessionHint(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);
}

/** Drop-in for server-rendered pages (the landing page) — renders nothing. */
export function AuthForward() {
  useForwardIfAuthed();
  return null;
}
