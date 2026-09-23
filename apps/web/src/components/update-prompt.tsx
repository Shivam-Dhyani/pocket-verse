'use client';

import { useEffect, useState } from 'react';
import { useDialogs } from '@/components/dialogs';
import { useUploadsStore } from '@/stores/uploads';

/** The build this page was loaded from (inlined at build time). */
const RUNNING_BUILD = process.env.NEXT_PUBLIC_BUILD_ID;
/** How often to re-check while the app just sits open in the foreground. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Offers a reload when a newer version has been deployed.
 *
 * Why not rely on the service worker: our worker's bytes don't change between
 * deploys, so the browser never sees a "new worker" — and on iOS an installed
 * app isn't reloaded at all when you reopen it; it resumes from memory, often
 * for days. So we ask the server directly: /version.json carries the deployed
 * build id, and if it differs from the one this page was built with, a newer
 * version is live. We check on launch, whenever the app comes back to the
 * foreground (the iOS "reopen" case), and every 30 minutes while it stays open.
 *
 * Never forced: reloading kills any upload in progress, so the user chooses
 * when, and is warned first if something is still uploading.
 */
export function UpdatePrompt() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dialogs = useDialogs();

  useEffect(() => {
    if (!RUNNING_BUILD || available) {
      return;
    }
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible' || !navigator.onLine) {
        return;
      }
      busy = true;
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (res.ok) {
          const { buildId } = (await res.json()) as { buildId?: string };
          if (buildId && buildId !== RUNNING_BUILD) {
            setAvailable(true);
          }
        }
      } catch {
        // Offline or mid-deploy — try again next time.
      } finally {
        busy = false;
      }
    };

    void check();
    const onVisible = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('online', onVisible);
    const timer = window.setInterval(onVisible, CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      window.removeEventListener('online', onVisible);
      window.clearInterval(timer);
    };
  }, [available]);

  if (!available || dismissed) {
    return null;
  }

  const onUpdate = async () => {
    const uploading = Object.values(useUploadsStore.getState().uploads).some(
      (entry) => entry.state === 'uploading' || entry.state === 'paused',
    );
    if (
      uploading &&
      !(await dialogs.confirm({
        title: 'Update now?',
        message:
          'Updating reloads Pocketverse, which stops the uploads in progress. You can drop the same files again later and they’ll continue where they left off.',
        confirmLabel: 'Update anyway',
        cancelLabel: 'Not now',
      }))
    ) {
      return;
    }
    window.location.reload();
  };

  return (
    <div className="pv-update-toast" role="status" aria-live="polite">
      <span>A new version of Pocketverse is available.</span>
      <button className="pv-button" type="button" onClick={() => void onUpdate()}>
        Update
      </button>
      <button
        className="pv-update-toast__close"
        type="button"
        aria-label="Later"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
