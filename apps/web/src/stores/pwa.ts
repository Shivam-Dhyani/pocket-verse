import { create } from 'zustand';

/**
 * The browser fires `beforeinstallprompt` once, early, and only if the app is
 * installable and not already installed. We capture that event at app root and
 * park it here so the Install button in Settings can trigger it on demand —
 * this is what keeps installation opt-in instead of an unprompted banner.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  /** The parked install event, or null when the browser hasn't offered one. */
  deferredPrompt: BeforeInstallPromptEvent | null;
  /** True once the app is running installed (standalone) or was just installed. */
  installed: boolean;
  setDeferredPrompt: (event: BeforeInstallPromptEvent | null) => void;
  setInstalled: (installed: boolean) => void;
}

export const usePwaStore = create<PwaState>((set) => ({
  deferredPrompt: null,
  installed: false,
  setDeferredPrompt: (deferredPrompt) => set({ deferredPrompt }),
  setInstalled: (installed) => set(installed ? { installed, deferredPrompt: null } : { installed }),
}));

/** True when the page is being viewed as an installed app (any platform). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari doesn't support display-mode; it exposes this instead.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iOS has no install prompt — the app must be added via the Share sheet. */
export function isIos(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
    // iPadOS 13+ reports as desktop Safari but is touch-capable.
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
  );
}
