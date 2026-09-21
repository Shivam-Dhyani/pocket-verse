import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // The service worker must always be revalidated. If a CDN or browser
        // serves a stale /sw.js, installed apps keep running the old worker and
        // a redeploy can take up to 24h to reach them (or never, if cached
        // hard). Everything else is content-hashed and safe to cache.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ];
  },
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
