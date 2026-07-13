'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { passwordSchema } from '@pocketverse/shared';
import { api, ApiError } from '@/lib/api';
import { PasswordField } from '@/components/password-field';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: api.resetPassword,
    onSuccess: () => setDone(true),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = passwordSchema.safeParse(new FormData(event.currentTarget).get('password'));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the password and try again.');
      return;
    }
    mutation.mutate({ token, password: parsed.data });
  }

  return (
    <main className="pv-shell">
      <Link href="/" className="pv-brand">
        Pocketverse
      </Link>
      <div className="pv-card">
        <h1>Choose a new password</h1>
        {done ? (
          <>
            <p className="pv-sub">
              Your password is updated, and every other signed-in session has been signed out.
            </p>
            <Link href="/login">
              <button className="pv-button" type="button">
                Sign in with your new password
              </button>
            </Link>
          </>
        ) : !token ? (
          <>
            <p className="pv-sub">
              This page needs the link from your reset email. If yours has expired, request a new
              one.
            </p>
            <p className="pv-footnote">
              <Link href="/forgot-password">Request a reset link</Link>
            </p>
          </>
        ) : (
          <>
            {error && (
              <div className="pv-error" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={onSubmit}>
              <PasswordField
                label="New password (at least 10 characters)"
                name="password"
                autoComplete="new-password"
                required
              />
              <button className="pv-button" type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
