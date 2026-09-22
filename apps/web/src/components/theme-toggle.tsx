'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from '@/components/icons';
import { applyTheme } from '@/lib/theme';

/** Dark is the default; the choice persists and beats system preference. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const stored = window.localStorage.getItem('pv-theme');
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    // applyTheme also repaints the browser/OS chrome (theme-color), which is
    // what keeps the PWA's status bar from staying dark in light mode.
    applyTheme(theme);
    window.localStorage.setItem('pv-theme', theme);
  }, [theme]);

  return (
    <button
      className="pv-iconbtn"
      type="button"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
