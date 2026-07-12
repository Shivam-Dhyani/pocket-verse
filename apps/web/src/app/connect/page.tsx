'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { ConnectionDto } from '@pocketverse/shared';
import { ApiError } from '@/lib/api';
import { connectionApi } from '@/lib/connection';
import { useAuthStore } from '@/stores/auth';
import { OrbitLogo, ShieldIcon } from '@/components/icons';
import { PasswordField } from '@/components/password-field';

type Stage = 'disclosures' | 'phone' | 'code' | 'password' | 'done';

const STAGES: Stage[] = ['disclosures', 'phone', 'code', 'password', 'done'];

export default function ConnectPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((state) => state.accessToken);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [passedDisclosures, setPassedDisclosures] = useState(false);

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

  // Derive the wizard stage from server state + local disclosure gate.
  const stage: Stage =
    connection?.status === 'connected'
      ? 'done'
      : connection?.status === 'pending_password'
        ? 'password'
        : connection?.status === 'pending_code'
          ? 'code'
          : passedDisclosures
            ? 'phone'
            : 'disclosures';
  const stageIndex = STAGES.indexOf(stage);

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
        <p className="pv-footnote">
          <span className="pv-spinner" /> Checking your connection…
        </p>
      </main>
    );
  }

  return (
    <main className="pv-shell">
      <Link href="/drive" className="pv-brand">
        <OrbitLogo width={22} height={22} /> Pocketverse
      </Link>

      <div className="pv-card">
        <div className="pv-steps" aria-hidden>
          {STAGES.slice(0, 4).map((_, index) => (
            <span key={index} className={`pv-step-dot${index <= stageIndex ? ' done' : ''}`} />
          ))}
        </div>

        {error && (
          <div className="pv-error" role="alert">
            {error}
          </div>
        )}

        {stage === 'disclosures' && (
          <>
            <h1>Before you connect</h1>
            <p className="pv-sub">The honest version — please read.</p>
            <ul className="pv-disclosure">
              <li>
                Signing in gives Pocketverse an access key to your storage account. We encrypt it
                and use it <em>only</em> to manage the private “Pocketverse Storage” channel.
              </li>
              <li>
                <strong>What we never do:</strong> read your chats, message anyone, or copy your
                files to our servers — file bytes only pass through, never stored by us.
              </li>
              <li>
                The storage platform deletes accounts inactive for 6 months. If that happens, the
                files stored there are gone — keep the account alive or keep backups.
              </li>
              <li>
                Files are encrypted in transit but not end-to-end by the platform, and this use of a
                personal account sits in a gray area of its terms of service.
              </li>
              <li>You can disconnect anytime — your channel and files stay in your account.</li>
            </ul>
            <label className="pv-check">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>I understand what access I’m granting and the risks above.</span>
            </label>
            <button
              className="pv-button pv-button--block"
              type="button"
              disabled={!agreed}
              onClick={() => setPassedDisclosures(true)}
            >
              Continue
            </button>
          </>
        )}

        {stage === 'phone' && (
          <>
            <h1>Connect your storage</h1>
            <p className="pv-sub">Enter the phone number for the account you’ll use as storage.</p>
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
              <button className="pv-button pv-button--block" type="submit" disabled={busy}>
                {start.isPending ? 'Sending code…' : 'Send sign-in code'}
              </button>
            </form>
          </>
        )}

        {stage === 'code' && (
          <>
            <h1>Enter your code</h1>
            <form onSubmit={submit((code) => verifyCode.mutate({ code }), 'code')}>
              <p className="pv-sub">
                We sent a code to {connection?.phoneMasked} via the storage app. It expires in a few
                minutes.
              </p>
              <label className="pv-field">
                <span>Sign-in code</span>
                <input name="code" inputMode="numeric" autoComplete="one-time-code" required />
              </label>
              <button className="pv-button pv-button--block" type="submit" disabled={busy}>
                {verifyCode.isPending ? 'Verifying…' : 'Verify code'}
              </button>
            </form>
          </>
        )}

        {stage === 'password' && (
          <>
            <h1>Two-step verification</h1>
            <form onSubmit={submit((password) => verifyPassword.mutate({ password }), 'password')}>
              <p className="pv-sub">This account has two-step verification enabled.</p>
              <PasswordField
                label="Two-step verification password"
                name="password"
                autoComplete="current-password"
                required
              />
              <button className="pv-button pv-button--block" type="submit" disabled={busy}>
                {verifyPassword.isPending ? 'Verifying…' : 'Finish connecting'}
              </button>
            </form>
          </>
        )}

        {stage === 'done' && (
          <div style={{ textAlign: 'center' }}>
            <ShieldIcon width={40} height={40} style={{ color: 'var(--pv-success)' }} />
            <h1 style={{ marginTop: 'var(--pv-s3)' }}>You’re connected</h1>
            <p className="pv-sub">
              Connected as {connection?.phoneMasked}. Your private storage channel is ready and
              encrypted.
            </p>
            <Link href="/drive">
              <button className="pv-button pv-button--block" type="button">
                Go to your drive
              </button>
            </Link>
          </div>
        )}
      </div>

      {stage !== 'done' && (
        <p className="pv-footnote" style={{ marginTop: 'var(--pv-s4)' }}>
          <ShieldIcon width={13} height={13} style={{ verticalAlign: '-2px' }} /> Your connection is
          encrypted at rest. <Link href="/security">How it works</Link>
        </p>
      )}
    </main>
  );
}
