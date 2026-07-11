'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { loginSchema } from '@pocketverse/shared';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);
  const [error, setError] = useState<string | null>(null);

  // Already signed in (e.g. pressed Back onto this page)? Go straight to the
  // drive instead of showing the sign-in form again.
  useEffect(() => {
    if (useAuthStore.getState().accessToken) {
      router.replace('/drive');
    }
  }, [router]);

  const mutation = useMutation({
    mutationFn: api.login,
    onSuccess: (result) => {
      setSession(result);
      // replace, not push: keep /login out of history so Back doesn't land here.
      router.replace('/drive');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const data = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: data.get('email'),
      password: data.get('password'),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your details and try again.');
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <main className="pv-shell">
      <Link href="/" className="pv-brand">
        Pocketverse
      </Link>
      <div className="pv-card">
        <h1>Welcome back</h1>
        <p className="pv-sub">Sign in to open your universe.</p>

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
          <label className="pv-field">
            <span>Password</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="pv-button" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="pv-footnote">
          New here? <Link href="/register">Create an account</Link>
        </p>
      </div>
    </main>
  );
}
