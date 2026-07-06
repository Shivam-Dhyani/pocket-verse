'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

/**
 * Placeholder shell for the Drive UI (Phase 4). For now it proves the auth
 * loop: silent refresh on reload, guarded route, sign-out.
 */
export default function DrivePage() {
  const router = useRouter();
  const { user, clearSession } = useAuthStore();

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      // Recover the session after a reload before asking who we are.
      if (!useAuthStore.getState().accessToken) {
        await api.refresh();
      }
      return api.me();
    },
    retry: false,
  });

  useEffect(() => {
    if (me.isError) {
      router.replace('/login');
    }
  }, [me.isError, router]);

  async function signOut() {
    await api.logout().catch(() => undefined);
    clearSession();
    router.replace('/');
  }

  if (me.isPending) {
    return (
      <main className="pv-shell">
        <p className="pv-footnote">Opening your universe…</p>
      </main>
    );
  }

  if (me.isError) {
    return null;
  }

  return (
    <main className="pv-shell">
      <span className="pv-brand">Pocketverse</span>
      <div className="pv-card">
        <h1>Your drive</h1>
        <p className="pv-sub">
          Signed in as {user?.email ?? me.data.user.email}. File storage arrives in the next phase —
          your account and encrypted session handling are live.
        </p>
        <button className="pv-button pv-button--ghost" type="button" onClick={signOut}>
          Sign out
        </button>
      </div>
    </main>
  );
}
