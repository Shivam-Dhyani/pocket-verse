'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@/lib/api';
import { connectionApi } from '@/lib/connection';
import { useDialogs } from '@/components/dialogs';
import { EyeIcon, EyeOffIcon } from '@/components/icons';

/**
 * Account-management control for the linked Telegram account: shows who is
 * connected (masked, with an explicit reveal), and lets the user disconnect.
 */
export function ConnectionManager() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const dialogs = useDialogs();
  const [error, setError] = useState<string | null>(null);
  const [fullPhone, setFullPhone] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

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

  async function togglePhone() {
    if (fullPhone) {
      setFullPhone(null);
      return;
    }
    setRevealing(true);
    try {
      const { phone } = await connectionApi.revealPhone();
      setFullPhone(phone);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'PHONE_UNAVAILABLE'
          ? 'The full number is only stored for connections made after this update — reconnect once to enable it.'
          : 'Could not fetch the full number. Please try again.',
      );
    } finally {
      setRevealing(false);
    }
  }

  const connection = status.data?.connection;

  return (
    <section className="pv-section">
      <h2>Your connected Telegram account</h2>
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
          <p
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--pv-s2)', flexWrap: 'wrap' }}
          >
            <span>
              {connection.status === 'connected' ? 'Connected as' : 'Set up for'}{' '}
              <strong>{fullPhone ?? connection.phoneMasked}</strong>
            </span>
            <button
              className="pv-iconbtn"
              type="button"
              title={fullPhone ? 'Hide number' : 'Show full number'}
              aria-label={fullPhone ? 'Hide number' : 'Show full number'}
              disabled={revealing}
              onClick={() => void togglePhone()}
            >
              {revealing ? (
                <span className="pv-spinner" style={{ width: 14, height: 14 }} />
              ) : fullPhone ? (
                <EyeOffIcon width={16} height={16} />
              ) : (
                <EyeIcon width={16} height={16} />
              )}
            </button>
          </p>
          <p className="pv-sub" style={{ marginTop: 0 }}>
            {connection.status === 'connected'
              ? 'Your files sync to a private “Pocketverse Storage” channel inside this Telegram account.'
              : 'This connection needs attention — reconnect to continue syncing.'}
          </p>
          <button
            className="pv-button pv-button--danger"
            type="button"
            disabled={disconnect.isPending}
            onClick={() => {
              void dialogs
                .confirm({
                  title: 'Disconnect Telegram',
                  message:
                    'Pocketverse will sign out of your Telegram account and clear the files it lists here — because it can no longer reach them once disconnected. Your files themselves stay safe in your Telegram “Pocketverse Storage” channel; Pocketverse just stops tracking them. Reconnecting starts with a clean drive.',
                  confirmLabel: 'Disconnect',
                  danger: true,
                })
                .then((ok) => {
                  if (ok) {
                    disconnect.mutate();
                  }
                });
            }}
          >
            {disconnect.isPending ? 'Disconnecting…' : 'Disconnect Telegram'}
          </button>
        </>
      ) : (
        <p>
          No Telegram account is connected. <Link href="/connect">Connect your storage →</Link>
        </p>
      )}
    </section>
  );
}
