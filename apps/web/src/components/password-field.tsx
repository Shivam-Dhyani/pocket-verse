'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { EyeIcon, EyeOffIcon } from '@/components/icons';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
};

/**
 * Password input with a show/hide eye toggle. The toggle is a real button
 * (keyboard reachable, labelled for screen readers) but stays out of the tab
 * order so Tab still goes field → field in forms.
 */
export function PasswordField({ label, ...inputProps }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="pv-field">
      <span>{label}</span>
      <span className="pv-password-wrap">
        <input type={visible ? 'text' : 'password'} {...inputProps} />
        <button
          type="button"
          className="pv-password-toggle"
          aria-label={visible ? 'Hide password' : 'Show password'}
          title={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon width={18} height={18} /> : <EyeIcon width={18} height={18} />}
        </button>
      </span>
    </label>
  );
}
