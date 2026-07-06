'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { connectionApi } from '@/lib/connection';
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

  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: connectionApi.status,
    retry: false,
    enabled: me.isSuccess,
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

  const conn = connection.data?.connection;

  return (
    <main className="pv-shell">
      <span className="pv-brand">Pocketverse</span>
      <div className="pv-card">
        <h1>Your drive</h1>

        {conn?.status === 'connected' ? (
          <span className="pv-badge pv-badge--ok">● Storage connected — {conn.phoneMasked}</span>
        ) : conn?.status === 'error' ? (
          <span className="pv-badge pv-badge--warn">● Storage connection needs attention</span>
        ) : (
          <span className="pv-badge">○ Storage not connected</span>
        )}

        <p className="pv-sub">
          Signed in as {user?.email ?? me.data.user.email}.{' '}
          {conn?.status === 'connected'
            ? 'File storage arrives in the next phase — your encrypted connection is live.'
            : 'Connect your own storage to give your files a home.'}
        </p>

        {conn?.status !== 'connected' && (
          <Link href="/connect">
            <button className="pv-button" type="button">
              Connect storage
            </button>
          </Link>
        )}
        <button className="pv-button pv-button--ghost" type="button" onClick={signOut}>
          Sign out
        </button>
      </div>
    </main>
  );
}
