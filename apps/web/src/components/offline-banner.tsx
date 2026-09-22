'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Tracks connectivity. The service worker's offline page only appears on a hard
 * navigation, so inside the running app (and the installed PWA, where you
 * rarely navigate) losing the network otherwise surfaced as a generic
 * "can't reach the server" error on whatever you happened to tap. This says it
 * plainly instead.
 *
 * `navigator.onLine === false` is a reliable "definitely offline"; `true` only
 * means a network interface exists, so we never claim more than that.
 */
function useIsOnline(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    return () => {
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
    };
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // Assume online while prerendering so the banner never flashes in the HTML.
    () => true,
  );
}

export function OfflineBanner() {
  const online = useIsOnline();
  if (online) {
    return null;
  }
  return (
    <div className="pv-offline-bar" role="status" aria-live="polite">
      You’re offline — your files are safe, but Pocketverse can’t reach them until you reconnect.
    </div>
  );
}
