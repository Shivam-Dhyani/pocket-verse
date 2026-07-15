import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

// Wrapping is safe without Sentry credentials: with no auth token it simply
// skips source-map upload (stack traces stay minified) and never fails the
// build. Set SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN to get readable stack
// traces. Runtime capture is gated on the DSN in the sentry.*.config files.
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  disableLogger: true,
});
