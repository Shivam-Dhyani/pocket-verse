'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Modal } from '@/components/ui';

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  message?: ReactNode;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
}

interface NoticeOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
}

interface DialogsApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  /** A single-button informational dialog (no destructive choice to make). */
  notice: (options: NoticeOptions) => Promise<void>;
}

const DialogsContext = createContext<DialogsApi | null>(null);

export function useDialogs(): DialogsApi {
  const ctx = useContext(DialogsContext);
  if (!ctx) {
    throw new Error('useDialogs must be used within <DialogsProvider>');
  }
  return ctx;
}

type State =
  | { kind: 'confirm'; options: ConfirmOptions }
  | { kind: 'prompt'; options: PromptOptions; value: string }
  | { kind: 'notice'; options: NoticeOptions }
  | null;

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(null);
  // Holds the resolver for the currently-open dialog.
  const resolver = useRef<((value: unknown) => void) | null>(null);

  const settle = useCallback((value: unknown) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  }, []);

  const api = useMemo<DialogsApi>(
    () => ({
      confirm: (options) =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve as (value: unknown) => void;
          setState({ kind: 'confirm', options });
        }),
      prompt: (options) =>
        new Promise<string | null>((resolve) => {
          resolver.current = resolve as (value: unknown) => void;
          setState({ kind: 'prompt', options, value: options.initial ?? '' });
        }),
      notice: (options) =>
        new Promise<void>((resolve) => {
          resolver.current = resolve as (value: unknown) => void;
          setState({ kind: 'notice', options });
        }),
    }),
    [],
  );

  return (
    <DialogsContext.Provider value={api}>
      {children}
      {state?.kind === 'confirm' && (
        <Modal title={state.options.title} onClose={() => settle(false)}>
          {state.options.message && (
            <p style={{ margin: '0 0 var(--pv-s5)', color: 'var(--pv-text-muted)' }}>
              {state.options.message}
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--pv-s2)', justifyContent: 'flex-end' }}>
            <button
              className="pv-button pv-button--ghost"
              type="button"
              onClick={() => settle(false)}
            >
              {state.options.cancelLabel ?? 'Cancel'}
            </button>
            <button
              className={`pv-button${state.options.danger ? ' pv-button--danger' : ''}`}
              type="button"
              autoFocus
              onClick={() => settle(true)}
            >
              {state.options.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
      {state?.kind === 'notice' && (
        <Modal title={state.options.title} onClose={() => settle(undefined)}>
          {state.options.message && (
            <div
              style={{
                margin: '0 0 var(--pv-s5)',
                color: 'var(--pv-text-muted)',
                lineHeight: 1.55,
              }}
            >
              {state.options.message}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="pv-button" type="button" autoFocus onClick={() => settle(undefined)}>
              {state.options.confirmLabel ?? 'Got it'}
            </button>
          </div>
        </Modal>
      )}
      {state?.kind === 'prompt' && (
        <Modal title={state.options.title} onClose={() => settle(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              settle(state.value.trim() ? state.value.trim() : null);
            }}
          >
            {state.options.message && (
              <p style={{ margin: '0 0 var(--pv-s4)', color: 'var(--pv-text-muted)' }}>
                {state.options.message}
              </p>
            )}
            <label className="pv-field">
              {state.options.label && <span>{state.options.label}</span>}
              <input
                autoFocus
                value={state.value}
                placeholder={state.options.placeholder}
                onChange={(event) =>
                  setState((prev) =>
                    prev?.kind === 'prompt' ? { ...prev, value: event.target.value } : prev,
                  )
                }
              />
            </label>
            <div style={{ display: 'flex', gap: 'var(--pv-s2)', justifyContent: 'flex-end' }}>
              <button
                className="pv-button pv-button--ghost"
                type="button"
                onClick={() => settle(null)}
              >
                Cancel
              </button>
              <button className="pv-button" type="submit">
                {state.options.confirmLabel ?? 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </DialogsContext.Provider>
  );
}
