import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// Where the Express API actually lives. Used only to proxy auth calls (below).
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Identifies this deploy. Baked into the client bundle AND served live at
// /version.json, so a running app (notably an installed iOS app, which resumes
// from memory for days without reloading) can tell it is out of date and offer
// an update — see components/update-prompt.tsx.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  async rewrites() {
    return [
      {
        // Auth is the ONLY traffic proxied through the web origin, and it is
        // proxied for one reason: the refresh cookie. Called directly, the API
        // is a different site (vercel.app -> onrender.com), so that cookie is a
        // third-party cookie — Safari blocks those outright and Chrome
        // increasingly does too, which silently ends the session the moment the
        // in-memory access token goes away (i.e. when the tab or browser is
        // closed). Proxied, the cookie is set by our own origin and is simply
        // first-party, so sessions survive.
        //
        // Deliberately NOT proxied: uploads and downloads. Those stream
        // multi-GB bodies and must keep going straight to the API — a
        // serverless proxy in front of them would hit body-size and duration
        // limits.
        source: '/api/auth/:path*',
        destination: `${API_ORIGIN}/api/auth/:path*`,
      },
    ];
  },
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
        // Must never be cached anywhere, or a running app would keep reading
        // the old build id and never learn a new version shipped.
        source: '/version.json',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
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
