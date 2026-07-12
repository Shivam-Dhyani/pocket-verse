import { create } from 'zustand';
import type { UserDto } from '@pocketverse/shared';

/**
 * The access token lives only in memory (never localStorage — XSS-resistant);
 * the refresh token lives in an httpOnly cookie the JS can't read. A page
 * reload silently recovers the session via /api/auth/refresh.
 */
interface AuthState {
  accessToken: string | null;
  user: UserDto | null;
  setSession: (session: { accessToken: string; user: UserDto }) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setSession: ({ accessToken, user }) => {
    setSessionHint(true);
    set({ accessToken, user });
  },
  clearSession: () => {
    setSessionHint(false);
    set({ accessToken: null, user: null });
  },
}));

/**
 * A non-secret "this browser has a session" marker. The refresh token itself is
 * httpOnly (unreadable), so this hint is how pages like the landing page know
 * it's worth attempting a silent refresh — anonymous visitors skip the network
 * round-trip entirely.
 */
const SESSION_HINT_KEY = 'pv-session';

export function setSessionHint(present: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (present) {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
  } else {
    window.localStorage.removeItem(SESSION_HINT_KEY);
  }
}

export function hasSessionHint(): boolean {
  return typeof window !== 'undefined' && window.localStorage.getItem(SESSION_HINT_KEY) === '1';
}
