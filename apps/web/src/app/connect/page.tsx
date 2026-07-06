'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { ConnectionDto } from '@pocketverse/shared';
import { ApiError } from '@/lib/api';
import { connectionApi } from '@/lib/connection';
import { useAuthStore } from '@/stores/auth';

/**
 * Storage-connection flow: phone → code → (2FA password). Functional version;
 * the full onboarding wizard design lands in Phase 4. The disclosures below
 * are a product requirement, not decoration — trust is built by stating risks
 * up front.
 */
export default function ConnectPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((state) => state.accessToken);
  const [error, setError] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ['connection'],
    queryFn: connectionApi.status,
    retry: false,
  });

  useEffect(() => {
    if (status.isError && !accessToken) {
      router.replace('/login');
    }
  }, [status.isError, accessToken, router]);

  const stepCallbacks = {
    onSuccess: (data: { connection: ConnectionDto }) => {
      setError(null);
      queryClient.setQueryData(['connection'], data);
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'),
  };

  const start = useMutation({ mutationFn: connectionApi.start, ...stepCallbacks });
  const verifyCode = useMutation({ mutationFn: connectionApi.verifyCode, ...stepCallbacks });
  const verifyPassword = useMutation({
    mutationFn: connectionApi.verifyPassword,
    ...stepCallbacks,
  });

  const connection = status.data?.connection;
  const busy = start.isPending || verifyCode.isPending || verifyPassword.isPending;

  function submit(handler: (value: string) => void, field: string) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const value = String(new FormData(event.currentTarget).get(field) ?? '').trim();
      if (value) {
        handler(value);
      }
    };
  }

  if (status.isPending) {
    return (
      <main className="pv-shell">
        <p className="pv-footnote">Checking your connection…</p>
      </main>
    );
  }

  return (
    <main className="pv-shell">
      <Link href="/drive" className="pv-brand">
        Pocketverse
      </Link>

      <div className="pv-card">
        <h1>Connect your storage</h1>
        <p className="pv-sub">
          Pocketverse stores your files in a private channel inside your own Telegram account.
        </p>

        {error && (
          <div className="pv-error" role="alert">
            {error}
          </div>
        )}

        {(!connection || connection.status === 'none' || connection.status === 'error') && (
          <>
            {connection?.status === 'error' && connection.lastError && (
              <div className="pv-error" role="alert">
                {connection.lastError}
              </div>
            )}
            <form onSubmit={submit((phone) => start.mutate({ phone }), 'phone')}>
              <label className="pv-field">
                <span>Phone number (international format)</span>
                <input
                  name="phone"
                  type="tel"
                  placeholder="+14155552671"
                  autoComplete="tel"
                  required
                />
              </label>
              <button className="pv-button" type="submit" disabled={busy}>
                {start.isPending ? 'Sending code…' : 'Send sign-in code'}
              </button>
            </form>
          </>
        )}

        {connection?.status === 'pending_code' && (
          <form onSubmit={submit((code) => verifyCode.mutate({ code }), 'code')}>
            <p className="pv-sub">
              We sent a code to {connection.phoneMasked} via Telegram. It expires in a few minutes.
            </p>
            <label className="pv-field">
              <span>Sign-in code</span>
              <input name="code" inputMode="numeric" autoComplete="one-time-code" required />
            </label>
            <button className="pv-button" type="submit" disabled={busy}>
              {verifyCode.isPending ? 'Verifying…' : 'Verify code'}
            </button>
          </form>
        )}

        {connection?.status === 'pending_password' && (
          <form onSubmit={submit((password) => verifyPassword.mutate({ password }), 'password')}>
            <p className="pv-sub">This account has two-step verification enabled.</p>
            <label className="pv-field">
              <span>Two-step verification password</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button className="pv-button" type="submit" disabled={busy}>
              {verifyPassword.isPending ? 'Verifying…' : 'Finish connecting'}
            </button>
          </form>
        )}

        {connection?.status === 'connected' && (
          <>
            <p className="pv-sub">
              ✅ Connected as {connection.phoneMasked}. Your private storage channel is ready.
            </p>
            <Link href="/drive">
              <button className="pv-button" type="button">
                Go to your drive
              </button>
            </Link>
          </>
        )}
      </div>

      <div className="pv-card">
        <h1>Before you connect — the honest version</h1>
        <p className="pv-sub">What this access means, stated plainly:</p>
        <ul className="pv-disclosure">
          <li>
            Signing in gives Pocketverse an access key to your Telegram account. We encrypt it and
            use it <em>only</em> to manage the private “Pocketverse Storage” channel we create.
          </li>
          <li>
            <strong>What we never do:</strong> read your chats, message anyone, or copy your files
            to our servers — file bytes only pass through, they are never stored by us.
          </li>
          <li>
            Telegram deletes accounts that stay inactive (6 months by default). If that happens, the
            files stored there are gone — keep the account alive, or keep backups of irreplaceable
            files.
          </li>
          <li>
            Files are encrypted in transit but not end-to-end encrypted by Telegram itself, and this
            use of a personal account sits in a gray area of Telegram's terms of service.
          </li>
          <li>You can disconnect at any time — your channel and files stay in your account.</li>
        </ul>
      </div>
    </main>
  );
}
