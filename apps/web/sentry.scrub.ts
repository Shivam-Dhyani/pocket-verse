/**
 * Shared Sentry scrubbing for Pocketverse. This app handles session strings,
 * auth tokens, reset/download tokens, phone numbers and file names — NONE of
 * which may ever leave for a third party. So we run Sentry with PII off and
 * aggressively strip anything sensitive from events and breadcrumbs before
 * they're sent. Better to lose a little debugging context than to leak a
 * secret.
 */
import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/nextjs';

/** Remove the query string (may carry reset/download tokens) from a URL. */
function stripQuery(url?: string): string | undefined {
  if (!url) return url;
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

export function scrubEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  // Never send request bodies, cookies, or auth headers.
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.Authorization;
      delete event.request.headers.cookie;
    }
    event.request.url = stripQuery(event.request.url);
    if (event.request.query_string) {
      event.request.query_string = undefined;
    }
  }
  // Drop any user identifiers Sentry may have inferred.
  delete event.user;
  return event;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  // fetch/xhr breadcrumbs carry request URLs (with tokens) — strip the query.
  if ((crumb.category === 'fetch' || crumb.category === 'xhr') && crumb.data) {
    crumb.data.url = stripQuery(typeof crumb.data.url === 'string' ? crumb.data.url : undefined);
  }
  // Console/UI-input breadcrumbs can echo file names or typed passwords — drop.
  if (crumb.category === 'console' || crumb.category === 'ui.input') {
    return null;
  }
  return crumb;
}

/** Init options shared by client/server/edge — inert unless a DSN is set. */
export const sharedSentryOptions = {
  tracesSampleRate: 0.1,
  sendDefaultPii: false as const,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
};
