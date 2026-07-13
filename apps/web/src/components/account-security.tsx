'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { changePasswordSchema } from '@pocketverse/shared';
import { api, ApiError } from '@/lib/api';
import { PasswordField } from '@/components/password-field';

/** Change-password control shown on the Security page. */
export function AccountSecurity() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: api.changePassword,
    onSuccess: () => {
      setSaved(true);
      setOpen(false);
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const parsed = changePasswordSchema.safeParse({
      currentPassword: data.get('currentPassword'),
      newPassword: data.get('newPassword'),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the fields and try again.');
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <section className="pv-section">
      <h2>Your account</h2>
      {saved && !open ? (
        <p className="pv-sub">
          Password updated. Every other signed-in device has been signed out.
        </p>
      ) : (
        <p className="pv-sub">
          Change your Pocketverse password. Other devices signed in to your account will be signed
          out.
        </p>
      )}
      {!open ? (
        <button
          className="pv-button pv-button--ghost"
          type="button"
          onClick={() => {
            setSaved(false);
            setOpen(true);
          }}
        >
          Change password
        </button>
      ) : (
        <form onSubmit={onSubmit} style={{ maxWidth: 420 }}>
          {error && (
            <div className="pv-error" role="alert">
              {error}
            </div>
          )}
          <PasswordField
            label="Current password"
            name="currentPassword"
            autoComplete="current-password"
            required
          />
          <PasswordField
            label="New password (at least 10 characters)"
            name="newPassword"
            autoComplete="new-password"
            required
          />
          <div style={{ display: 'flex', gap: 'var(--pv-s2)' }}>
            <button
              className="pv-button pv-button--ghost"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button className="pv-button" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Update password'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
