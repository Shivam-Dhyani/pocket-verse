/**
 * Sentry initialization for the API. Imported FIRST in index.ts (before any
 * other module) so Sentry can auto-instrument Express, HTTP, etc.
 *
 * Privacy is non-negotiable here: request bodies carry passwords, OTP codes and
 * session data; cookies carry refresh tokens; query strings carry download
 * tokens. NONE may reach Sentry. So PII is off and everything sensitive is
 * scrubbed before send. Inert (no init) unless SENTRY_DSN is set.
 */
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data; // bodies: passwords, codes, sessions
        delete event.request.cookies; // refresh token
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.Authorization;
          delete event.request.headers.cookie;
        }
        // Query strings can carry download tokens.
        if (typeof event.request.url === 'string') {
          event.request.url = event.request.url.split('?')[0];
        }
        event.request.query_string = undefined;
      }
      delete event.user;
      return event;
    },
  });
}

export { Sentry };
