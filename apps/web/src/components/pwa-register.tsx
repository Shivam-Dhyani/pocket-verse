'use client';

import { useEffect } from 'react';
import { isStandalone, usePwaStore, type BeforeInstallPromptEvent } from '@/stores/pwa';

/**
 * Mounted once at app root. Two jobs, both invisible to the user:
 *   1. Register the service worker (needed for installability + offline page).
 *   2. Intercept `beforeinstallprompt` so the browser NEVER shows its automatic
 *      install banner — we stash the event for the opt-in button in Settings.
 * Renders nothing.
 */
export function PwaRegister() {
  const setDeferredPrompt = usePwaStore((s) => s.setDeferredPrompt);
  const setInstalled = usePwaStore((s) => s.setInstalled);

  useEffect(() => {
    if (isStandalone()) setInstalled(true);

    const onBeforeInstallPrompt = (event: Event) => {
      // Stop the mini-infobar / automatic prompt; keep the event for later.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    // Register after load so it never competes with first paint.
    if ('serviceWorker' in navigator) {
      const register = () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
          // A failed SW registration must never break the app — installability
          // and the offline page are enhancements, not requirements.
        });
      };
      if (document.readyState === 'complete') register();
      else window.addEventListener('load', register, { once: true });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [setDeferredPrompt, setInstalled]);

  return null;
}
