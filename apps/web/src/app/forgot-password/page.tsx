'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { forgotPasswordSchema } from '@pocketverse/shared';
import { api, ApiError } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const mutation = useMutation({
    mutationFn: api.forgotPassword,
    onSuccess: () => setSent(true),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = forgotPasswordSchema.safeParse({
      email: new FormData(event.currentTarget).get('email'),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address.');
      return;
    }
    mutation.mutate(parsed.data.email);
  }

  return (
    <main className="pv-shell">
      <Link href="/" className="pv-brand">
        Pocketverse
      </Link>
      <div className="pv-card">
        <h1>Reset your password</h1>
        {sent ? (
          <>
            <p className="pv-sub">
              If an account exists for that email, a reset link is on its way. It works for 30
              minutes — check your inbox (and spam, just in case).
            </p>
            <p className="pv-footnote">
              <Link href="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <p className="pv-sub">
              Enter your account email and we&apos;ll send you a link to set a new password.
            </p>
            {error && (
              <div className="pv-error" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={onSubmit}>
              <label className="pv-field">
                <span>Email</span>
                <input name="email" type="email" autoComplete="email" required />
              </label>
              <button className="pv-button" type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <p className="pv-footnote">
              Remembered it? <Link href="/login">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
