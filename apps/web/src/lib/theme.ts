export type Theme = 'dark' | 'light';

/**
 * What the user chose. 'system' (the default) follows the phone/OS setting —
 * which is what keeps an installed app's system bars in agreement with it,
 * since on Android those bars follow the OS, not the page.
 */
export type ThemePreference = 'system' | Theme;

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
/** Persisted result of detectSystemBars(), so the next launch paints right. */
export const BARS_FIXED_KEY = 'pv-bars-fixed';

/*
 * How the system bars behave on the current device — the whole point of this
 * module. Android 15 made every app edge-to-edge: the status and navigation
 * bars are transparent and the OS ignores requests to colour them. What shows
 * through is whatever is drawn behind:
 *
 *  - If Chrome extends the installed app under the status bar (viewport-fit
 *    =cover, on builds that support it), our own page is behind it, so the bar
 *    follows the theme. theme-color then only sets the icon contrast.
 *  - If it doesn't, the window background (MANIFEST_BACKGROUND) is behind it,
 *    and it cannot change at runtime. theme-color *still* drives icon contrast,
 *    so following the light theme there puts dark icons on a dark band —
 *    effectively invisible. In that case theme-color must match the band.
 *
 * Android 14 and earlier still paint the bar from theme-color directly, so
 * following the theme is right there. `systemBarsFixed` is true only for the
 * one case where the band is stuck.
 */
let systemBarsFixed: boolean | null = null;

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}

function readBarsFixed(): boolean {
  if (systemBarsFixed === null) {
    try {
      systemBarsFixed = isStandalone() && window.localStorage.getItem(BARS_FIXED_KEY) === '1';
    } catch {
      systemBarsFixed = false;
    }
  }
  return systemBarsFixed;
}

/** What the phone should tint its status bar (and derive icon contrast) from. */
function systemBarColor(theme: Theme): string {
  return readBarsFixed() ? MANIFEST_BACKGROUND : THEME_COLORS[theme];
}

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
  meta.content = systemBarColor(theme);
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
  return preference === 'system' ? systemTheme() : preference;
}

/** The theme in effect right now. */
export function storedTheme(): Theme {
  return resolveTheme(storedPreference());
}

/** How far the page extends under the status bar, in px (0 = it doesn't). */
function safeAreaTop(): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top)';
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return px;
}

interface UADataValues {
  platform?: string;
  platformVersion?: string;
}
interface NavigatorUAData {
  getHighEntropyValues(hints: string[]): Promise<UADataValues>;
}

/** Real Android major version, or null when it can't be known. */
async function androidMajorVersion(): Promise<number | null> {
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  try {
    if (uaData) {
      const { platform, platformVersion } = await uaData.getHighEntropyValues(['platformVersion']);
      if (platform !== 'Android') {
        return null;
      }
      const major = parseInt(platformVersion ?? '', 10);
      return Number.isNaN(major) ? null : major;
    }
  } catch {
    // fall through to the UA string
  }
  // Chrome freezes the UA string at "Android 10" (UA reduction), so only a
  // higher number carries real information.
  const match = /Android (\d+)/.exec(navigator.userAgent);
  return match && Number(match[1]) > 10 ? Number(match[1]) : null;
}

/**
 * Works out whether the status bar band is stuck on the manifest colour, and
 * re-applies the theme if the answer changed. Cheap; call on mount and on
 * resize (safe-area insets change with orientation).
 *
 * Unknown platform or version → assume the bar follows theme-color, which is
 * today's behaviour, so detection can only ever improve on the default.
 */
export async function detectSystemBars(): Promise<void> {
  let fixed = false;
  if (isStandalone() && safeAreaTop() === 0) {
    const android = await androidMajorVersion();
    fixed = android !== null && android >= 15;
  }
  if (fixed === readBarsFixed()) {
    return;
  }
  systemBarsFixed = fixed;
  try {
    if (fixed) {
      window.localStorage.setItem(BARS_FIXED_KEY, '1');
    } else {
      window.localStorage.removeItem(BARS_FIXED_KEY);
    }
  } catch {
    // storage unavailable: detection still applies for this session
  }
  applyTheme(storedTheme());
}
