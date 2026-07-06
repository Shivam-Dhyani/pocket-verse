'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { registerSchema } from '@pocketverse/shared';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

export default function RegisterPage() {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: api.register,
    onSuccess: (result) => {
      setSession(result);
      router.push('/drive');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const data = new FormData(event.currentTarget);
    const parsed = registerSchema.safeParse({
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
        <h1>Create your account</h1>
        <p className="pv-sub">Your files, in storage you control.</p>

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
            <span>Password (at least 10 characters)</span>
            <input name="password" type="password" autoComplete="new-password" required />
          </label>
          <button className="pv-button" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating your account…' : 'Create account'}
          </button>
        </form>

        <p className="pv-footnote">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
