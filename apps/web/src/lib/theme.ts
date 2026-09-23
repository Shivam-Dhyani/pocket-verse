export type Theme = 'dark' | 'light';

/**
 * What the user chose. 'system' (the default) follows the phone/OS setting;
 * 'light' / 'dark' fix the theme regardless of the phone.
 */
export type ThemePreference = 'system' | Theme;

/**
 * THE SWITCH. While set, the app is locked to this theme: no toggle is shown,
 * stored preferences are ignored, and the phone's light/dark setting has no
 * effect. Set to `null` to bring back the Match device / Light / Dark choice —
 * all the light-mode styling (globals.css), the preference storage below, and
 * the controls in components/theme-toggle.tsx are kept intact for that.
 *
 * Locked to dark because an installed Android app's system bars can't reliably
 * follow an in-app theme (see docs/PWA.md), so light mode couldn't look right
 * there.
 */
export const FORCED_THEME: Theme | null = 'dark';

/**
 * Page background per theme — the single source of truth for every place the
 * app's colour reaches outside the page: the theme-color meta (phone status
 * bar), the pre-paint script in layout.tsx, and the manifest. Keep in sync
 * with --pv-bg in globals.css. Letting these drift apart is precisely what
 * produces a visible seam between the system bars and the app.
 */
export const THEME_COLORS: Record<Theme, string> = {
  dark: '#070b16',
  light: '#f4f6fc',
};

/**
 * The installed app's window background, i.e. the manifest's background_color.
 * On Android 15+ the system bars are transparent, and when Chrome does not
 * draw the page underneath them this is the colour that shows through — fixed
 * at install time, whatever theme the user picks.
 */
export const MANIFEST_BACKGROUND = THEME_COLORS.dark;

/**
 * Storage key for the preference. Deliberately NOT the old 'pv-theme': the old
 * two-state toggle wrote 'dark' on every mount, so its value never meant a real
 * choice — honouring it would have kept every existing user off 'system'.
 */
export const THEME_PREF_KEY = 'pv-theme-pref';
/**
 * Written by an earlier version that pinned theme-color on installed Android
 * apps; see applyTheme. Only referenced now so ThemeSync can clear it.
 */
export const LEGACY_BARS_FIXED_KEY = 'pv-bars-fixed';

/*
 * What the system bars of an installed Android app actually follow (confirmed
 * on a real phone and in Chromium bug reports):
 *
 *  - Status bar (top): the theme_color baked into the app at install time. No
 *    runtime signal from the page reaches it.
 *  - Navigation bar (bottom): the page's live <meta name="theme-color">, from
 *    Chrome 153. On older Chrome it follows the phone's light/dark setting.
 *
 * So theme-color must always be the app's own theme colour — that is what lets
 * the navigation bar follow the in-app toggle. (An earlier version pinned it to
 * the dark manifest colour on installed Android 15+ apps to protect the status
 * bar's icons. The status bar never reads it, so the pin did nothing there and
 * held the navigation bar dark in light mode instead.)
 */

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

/** The stored preference; 'system' when nothing (or nothing valid) is stored. */
export function storedPreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system';
  }
  try {
    const value = window.localStorage.getItem(THEME_PREF_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function savePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      window.localStorage.removeItem(THEME_PREF_KEY);
    } else {
      window.localStorage.setItem(THEME_PREF_KEY, preference);
    }
  } catch {
    // storage unavailable: the choice still applies for this session
  }
}

/** The OS/phone's current scheme. */
export function systemTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveTheme(preference: ThemePreference): Theme {
  if (FORCED_THEME) {
    return FORCED_THEME;
  }
  return preference === 'system' ? systemTheme() : preference;
}

/** The theme in effect right now. */
export function storedTheme(): Theme {
  return resolveTheme(storedPreference());
}
