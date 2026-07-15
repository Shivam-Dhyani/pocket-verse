// Server-side (Node runtime) Sentry init for the Next.js app's SSR.
import * as Sentry from '@sentry/nextjs';
import { sharedSentryOptions } from './sentry.scrub';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? 'production',
    ...sharedSentryOptions,
  });
}
