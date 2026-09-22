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

/** Applies a theme to the document: page styling *and* browser chrome. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', THEME_COLORS[theme]);
  }
}
