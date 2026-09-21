'use client';

import { useEffect, useState } from 'react';
import { track } from '@/lib/analytics';
import { CheckIcon, DownloadIcon } from '@/components/icons';
import { isIos, isStandalone, usePwaStore } from '@/stores/pwa';

/**
 * Opt-in "install this app" control for the Settings page. This is the ONLY
 * place Pocketverse invites installation — there is no automatic popup anywhere
 * (see pwa-register.tsx, which suppresses the browser's own banner). Users who
 * never open this section are never nudged.
 */
export function InstallApp() {
  const deferredPrompt = usePwaStore((s) => s.deferredPrompt);
  const installed = usePwaStore((s) => s.installed);
  const setInstalled = usePwaStore((s) => s.setInstalled);

  // Platform checks touch `window`, so resolve them after mount to stay
  // SSR-safe and avoid hydration mismatches.
  const [ios, setIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setIos(isIos());
    if (isStandalone()) setInstalled(true);
  }, [setInstalled]);

  async function onInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      track('app_installed');
      setInstalled(true);
    } else {
      setDismissed(true);
    }
    // The event can only be used once; clear it either way.
    usePwaStore.getState().setDeferredPrompt(null);
  }

  return (
    <section className="pv-section">
      <h2>Install the app</h2>

      {installed ? (
        <p className="pv-sub pv-install-done">
          <CheckIcon width={18} height={18} /> Pocketverse is installed on this device. Launch it
          from your home screen or app list.
        </p>
      ) : (
        <>
          <p className="pv-sub">
            Prefer an app icon over a browser tab? Install Pocketverse to launch it full-screen from
            your home screen or desktop. It’s completely optional — nothing changes about your
            account or files, and you can uninstall anytime.
          </p>

          {deferredPrompt ? (
            <button className="pv-button" type="button" onClick={onInstall}>
              <DownloadIcon width={18} height={18} /> Install Pocketverse
            </button>
          ) : ios ? (
            <ol className="pv-install-steps">
              <li>
                Tap the <strong>Share</strong> button in Safari’s toolbar.
              </li>
              <li>
                Choose <strong>Add to Home Screen</strong>.
              </li>
              <li>
                Tap <strong>Add</strong> — Pocketverse appears with your other apps.
              </li>
            </ol>
          ) : (
            <p className="pv-sub" style={{ marginTop: 'var(--pv-s2)' }}>
              Your browser can install Pocketverse from its menu — look for{' '}
              <strong>Install app</strong> or <strong>Add to Home Screen</strong> (often an install
              icon in the address bar). If you don’t see it, this browser may not support
              installing, or the app is already installed.
            </p>
          )}

          {dismissed && (
            <p className="pv-sub" style={{ marginTop: 'var(--pv-s2)' }}>
              No problem — you can install anytime from here.
            </p>
          )}
        </>
      )}
    </section>
  );
}
