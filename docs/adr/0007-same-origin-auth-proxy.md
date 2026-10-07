# ADR-0007: Keep cross-site sessions alive with a same-origin auth proxy

**Status:** Accepted · September 2026 · post-launch (PWA hardening)

## Context

The web app (`*.vercel.app`) and the API (`*.onrender.com`) are **different
sites**. The refresh-token cookie (ADR-0006) is therefore a **third-party
cookie**: Safari blocks these outright and Chrome increasingly does too. The
symptom is a session that silently ends the moment the in-memory access token is
gone (tab/browser closed) — fatal for an installed PWA, where that is the normal
lifecycle.

Making the cookie `SameSite=None; Secure` is necessary but **not sufficient** —
Safari's ITP still partitions/blocks third-party cookies regardless.

## Decision

**Proxy only the auth traffic through the web origin.** A Next.js rewrite sends
`/api/auth/:path*` from the web origin to the API, so the refresh cookie is set
by **our own origin** and is simply **first-party**. Everything else
(`/api/files`, `/api/drive`, …) still calls the API **directly**.

## Consequences

- Sessions persist across tab/browser restarts and in the installed PWA.
- **Uploads and downloads are deliberately NOT proxied:** they stream multi-GB
  bodies and must hit the API directly — a serverless proxy in front of them
  would hit body-size and duration limits.
- In production the refresh cookie is still `SameSite=None; Secure` (the request
  from the proxied call to the API remains cross-site server-to-server).
- The web app needs the API origin at build/runtime (`NEXT_PUBLIC_API_URL`) for
  the rewrite target.
