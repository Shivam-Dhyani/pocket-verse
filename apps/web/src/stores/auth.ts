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
  setSession: ({ accessToken, user }) => set({ accessToken, user }),
  clearSession: () => set({ accessToken: null, user: null }),
}));
