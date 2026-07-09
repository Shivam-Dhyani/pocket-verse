'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@/lib/api';
import { connectionApi } from '@/lib/connection';

/**
 * Account-management control for the linked storage: shows the connected
 * account (masked) and lets the user disconnect it. Disconnecting removes our
 * access and invalidates the session on the storage side — the user's channel
 * and files stay in their own account.
 */
export function ConnectionManager() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ['connection'],
    queryFn: connectionApi.status,
    retry: false,
  });

  const disconnect = useMutation({
    mutationFn: connectionApi.disconnect,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['connection'] });
      await queryClient.invalidateQueries({ queryKey: ['drive'] });
      router.push('/connect');
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not disconnect. Please try again.'),
  });

  const connection = status.data?.connection;

  return (
    <section className="pv-section">
      <h2>Your connected storage</h2>
      {error && (
        <div className="pv-error" role="alert">
          {error}
        </div>
      )}
      {status.isPending ? (
        <p>
          <span className="pv-spinner" /> Checking…
        </p>
      ) : connection && connection.status !== 'none' ? (
        <>
          <p>
            {connection.status === 'connected'
              ? `Connected as ${connection.phoneMasked}. Files sync to a private channel in this account.`
              : `A connection to ${connection.phoneMasked ?? 'your account'} is set up but needs attention.`}
          </p>
          <button
            className="pv-button pv-button--danger"
            type="button"
            disabled={disconnect.isPending}
            onClick={() => {
              if (
                window.confirm(
                  'Disconnect your storage? Pocketverse loses access and the session is signed out on the storage side. Your channel and files stay in your account — they are not deleted.',
                )
              ) {
                disconnect.mutate();
              }
            }}
          >
            {disconnect.isPending ? 'Disconnecting…' : 'Disconnect storage'}
          </button>
        </>
      ) : (
        <p>
          No storage is connected. <Link href="/connect">Connect your storage →</Link>
        </p>
      )}
    </section>
  );
}
