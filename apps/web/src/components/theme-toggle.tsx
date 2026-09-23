'use client';

import { useCallback, useEffect, useState } from 'react';
import { AutoThemeIcon, MoonIcon, SunIcon } from '@/components/icons';
import {
  applyTheme,
  resolveTheme,
  savePreference,
  storedPreference,
  type ThemePreference,
} from '@/lib/theme';

/** Fired when the preference changes, so every control showing it stays in sync. */
const CHANGE_EVENT = 'pv-theme-pref-change';

const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

const LABELS: Record<ThemePreference, string> = {
  system: 'Match device',
  light: 'Light',
  dark: 'Dark',
};

const ICONS: Record<ThemePreference, typeof SunIcon> = {
  system: AutoThemeIcon,
  light: SunIcon,
  dark: MoonIcon,
};

/**
 * The user's theme preference: 'system' (default) follows the phone, or a fixed
 * light/dark. Saved only when the user actually picks something — the old
 * toggle wrote on every mount, so an untouched default looked like a choice.
 */
function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    setPreferenceState(storedPreference());
    const onChange = () => setPreferenceState(storedPreference());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    savePreference(next);
    applyTheme(resolveTheme(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [preference, setPreference] as const;
}

/** Header control: shows the current mode, tap to cycle Match device → Light → Dark. */
export function ThemeToggle() {
  const [preference, setPreference] = useThemePreference();
  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length]!;
  const Icon = ICONS[preference];
  const label = `Theme: ${LABELS[preference]}. Switch to ${LABELS[next]}`;

  return (
    <button
      className="pv-iconbtn"
      type="button"
      onClick={() => setPreference(next)}
      aria-label={label}
      title={label}
    >
      <Icon />
    </button>
  );
}

/** Settings control: all three options visible at once — no guessing what a tap does. */
export function AppearanceSetting() {
  const [preference, setPreference] = useThemePreference();

  return (
    <section className="pv-section">
      <h2>Appearance</h2>
      <div className="pv-segmented" role="radiogroup" aria-label="Theme">
        {ORDER.map((option) => {
          const Icon = ICONS[option];
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={preference === option}
              className={preference === option ? 'active' : undefined}
              onClick={() => setPreference(option)}
            >
              <Icon width={16} height={16} /> {LABELS[option]}
            </button>
          );
        })}
      </div>
      <p className="pv-sub" style={{ marginTop: 'var(--pv-s3)' }}>
        <strong>Match device</strong> follows your phone or computer’s light/dark setting. In the
        installed app on Android, the phone’s own bars take their colour from the phone rather than
        from Pocketverse, so Match device is the setting that keeps the two in step.
      </p>
    </section>
  );
}
