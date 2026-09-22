export type Theme = 'dark' | 'light';

/**
 * The colour the browser paints its own chrome with. In an installed PWA this
 * is what tints the phone's status bar and the task-switcher header — so if it
 * never changes, those bars stay dark even in light mode. Keep these in sync
 * with --pv-bg in globals.css.
 */
export const THEME_COLORS: Record<Theme, string> = {
  dark: '#070b16',
  light: '#f4f6fc',
};

/**
 * Applies a theme to the document: page styling *and* browser chrome.
 *
 * The theme-color tag is replaced rather than edited, and any duplicates are
 * removed first: a stale or media-scoped tag left in the document wins
 * unpredictably, and the symptom is a status bar stuck on the wrong colour.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((tag) => tag.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = THEME_COLORS[theme];
  document.head.appendChild(meta);
}

/** The theme in effect: the stored choice, else the app default (dark). */
export function storedTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  try {
    return window.localStorage.getItem('pv-theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
