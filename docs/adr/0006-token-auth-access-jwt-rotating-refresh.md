# ADR-0006: Token auth — short-lived access JWT + rotating refresh-token family

**Status:** Accepted · July 2026 · Phase 1

## Context

The web app is a separate origin from the API, so auth travels over cross-site
requests. We need sessions that are **resistant to XSS token theft**, survive a
browser restart, and can be **revoked** if a token is stolen — without a
server-side session store for every request.

## Decision

- **Access token:** a **15-minute JWT** (jose, HS256) held **only in memory** in
  the browser — never in `localStorage` (XSS-resistant). It authorises API calls.
- **Refresh token:** a **30-day, rotating** token stored **only as a SHA-256
  hash** in the DB and delivered as an **`httpOnly` cookie** the JS can't read. A
  page reload silently recovers the session via `/api/auth/refresh`.
- **Rotation + reuse detection:** each refresh rotates the token; presenting a
  **revoked** (already-used/stolen) refresh token **revokes the entire session
  family**.

## Consequences

- A stolen access token is useful for at most 15 minutes; the refresh token is
  unreadable to JS and self-revoking on reuse.
- Sessions survive restarts via the cookie, but because web and API are
  **different sites** the cookie is third-party by default — which Safari blocks.
  That problem is solved separately (see ADR-0007).
- Token lifetimes are deliberately **code constants**, not env knobs, to keep the
  security posture uniform across deploys.
- Password change revokes all _other_ sessions; password reset revokes _all_.
