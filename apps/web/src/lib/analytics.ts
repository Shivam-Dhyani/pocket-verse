/**
 * Privacy-conscious analytics. Pocketverse's whole promise is "your data is
 * yours", so analytics stays deliberately blunt: page views and coarse
 * feature-usage counts only. We NEVER send file names, folder names, phone
 * numbers, emails, tokens, or anything that identifies a person or their
 * content. Query strings are stripped from page paths (they can carry reset
 * tokens). Analytics is off unless NEXT_PUBLIC_GA_ID is set (so dev and any
 * self-hoster who omits it send nothing).
 */
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
export const analyticsEnabled = Boolean(GA_ID);

type GtagParams = Record<string, string | number | boolean>;

interface GtagWindow extends Window {
  gtag?: (...args: unknown[]) => void;
}

/** Record a page view (path only — never the query string). */
export function pageview(path: string): void {
  if (!analyticsEnabled || typeof window === 'undefined') {
    return;
  }
  (window as GtagWindow).gtag?.('event', 'page_view', {
    page_path: path,
    page_location: `${window.location.origin}${path}`,
  });
}

/**
 * A coarse feature-usage event. Only pass non-identifying params (counts,
 * booleans, enum-like strings such as a view mode) — never names or content.
 */
export function track(event: AnalyticsEvent, params: GtagParams = {}): void {
  if (!analyticsEnabled || typeof window === 'undefined') {
    return;
  }
  (window as GtagWindow).gtag?.('event', event, params);
}

/** The allow-list of events we emit — keeps usage self-documenting and safe. */
export type AnalyticsEvent =
  | 'signed_up'
  | 'signed_in'
  | 'storage_connected'
  | 'upload_started'
  | 'file_previewed'
  | 'file_downloaded'
  | 'retry_sync_clicked'
  | 'view_mode_changed';
