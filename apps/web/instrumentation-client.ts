// Client-side Sentry init. Inert (no network, no cost) unless
// NEXT_PUBLIC_SENTRY_DSN is set, so dev and DSN-less deploys send nothing.
import * as Sentry from '@sentry/nextjs';
import { sharedSentryOptions } from './sentry.scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? 'production',
    ...sharedSentryOptions,
  });
}

// Required by Sentry for navigation instrumentation in the App Router.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
