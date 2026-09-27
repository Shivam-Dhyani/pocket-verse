# Pocketverse — Development Journey

The story of how Pocketverse was built, phase by phase. This is the **narrative**
companion to the day-by-day record in [`/logs`](../logs/) and the living technical
reference in [`docs/DATABASE.md`](DATABASE.md).

- **This file** = the arc: what each phase set out to do and how the product grew.
- **`/logs/YYYY-MM-DD.md`** = the granular record: every change, fix, and decision on
  the day it happened.
- **`docs/DATABASE.md`** = the current data model and API↔table map.

New to the codebase (human or Claude)? Read this file top to bottom for the shape of
the project, then skim the most recent log files for what changed lately.

---

## Overview

Pocketverse is a Drive-style file manager backed by storage the user controls — a
private channel in the user's own Telegram account. File bytes never touch our
servers; we hold only encrypted metadata and connection credentials. The product was
built in five planned phases, then hardened and polished through an ongoing
post-launch stream of UX and PWA work.

**Monorepo:** `apps/api` (Express 5 + TypeScript + Prisma/PostgreSQL + GramJS MTProto),
`apps/web` (Next.js 15 App Router + TanStack Query + Zustand), `packages/shared` (Zod
schemas/types shared by both).

---

## Phase 1 — Foundation, encryption core, user auth

_First committed 2026-07-06._

- **Envelope encryption** (AES-256-GCM, Node `crypto` only): a master keyring from env
  wraps per-user data keys; every ciphertext is bound to its context via AAD so values
  can't be swapped between rows. A multi-key keyring allows master-key rotation without
  downtime (`apps/api/src/lib/crypto`).
- **Passwords** hashed with argon2id (OWASP parameters). Identical errors for unknown
  email vs. wrong password — no account probing.
- **Tokens:** 15-minute access JWTs (jose, HS256) + 30-day rotating refresh tokens
  stored only as SHA-256 hashes, delivered as `httpOnly` cookies. Reused (stolen)
  refresh tokens revoke the whole session family.
- **Logging:** Pino with hard redaction of passwords, tokens, sessions, and key
  material — enforced by tests (`apps/api/src/lib/logger.test.ts`).
- No secrets in git — everything from env (`.env.example` documents each variable).

## Phase 2 — Storage connection

_First committed 2026-07-06._

- **MTProto user client (GramJS)** behind a `TelegramGateway` interface
  (`apps/api/src/lib/telegram/`): phone → OTP → optional 2FA login, then a private
  "Pocketverse Storage" channel is created in the user's account.
- **Restart-safe login:** the multi-step flow survives server sleeps — intermediate
  state is an encrypted blob in Postgres (10-minute TTL), never a live object in RAM.
- **Session strings** are envelope-encrypted per connection (AAD-bound to the user),
  redacted from logs, and never serialized into any API response — enforced by tests.
- **FLOOD_WAIT handling:** short waits are absorbed with retry; long ones surface as
  honest 429s with `retryAfterSeconds`. A per-user mutex serializes storage operations.
- **Design record:** [ADR-0001](adr/0001-session-key-encryption.md) — why sessions use a
  server-side master keyring (and why password-derived keys are a v2 opt-in).

## Phase 3 — Storage engine

_First committed 2026-07-07._

- **Resumable uploads:** the client sends files in small sequential parts (8 MB default)
  that stream to disk staging — an interrupted upload resumes from the last acknowledged
  part, and the server tells the client exactly where to resume after a restart
  (`STAGING_LOST` → new cursor). Progress shown is parts the server confirmed, never an
  estimate.
- **Chunking:** files are stored as ≤1.5 GB chunks (configurable), one channel message
  each; per-chunk sha256 checksums plus a whole-file checksum are recorded. Downloads
  stream chunk by chunk straight to the response — bytes are never buffered in RAM or
  persisted beyond transient staging.
- **Queue:** every transfer runs as a job with exponential-backoff retries
  (FLOOD_WAIT-aware). With `REDIS_URL` set, jobs run on BullMQ (survive restarts);
  without it an in-process runner applies the same policy.
- **Folders:** full CRUD with move/rename, cycle-proof moves, duplicate-name protection,
  and recursive delete that also removes the chunk messages from the user's storage.

## Phase 4 — Drive UI & trust surfaces

_First committed 2026-07-09._

- **Design system:** deep-space, dark-mode-first tokens (color, spacing, type, motion)
  with a clean light theme; Space Grotesk + Inter (self-hosted); an inline SVG icon set
  — no icon library. See `apps/web/src/app/globals.css`.
- **File browser:** grid/list toggle, breadcrumbs, drag-and-drop upload with **real**
  acknowledged-parts progress and **pause/resume**, per-file status badges with live
  sync %, inline image/PDF previews, move-to-folder dialog, and designed
  empty/loading/error states.
- **Search** across the whole drive (`GET /api/files/search`), with the containing
  folder shown.
- **Honest onboarding:** the `/connect` wizard leads with a full disclosures screen
  gated by a real "I understand" checkbox before any connection begins.
- **Security page** (`/security`): plain-language explanation of the encryption model
  and an honest statement of what the server can and cannot decrypt.
- **Activity log** (`/activity`): audit events in friendly language with relative
  timestamps and cursor pagination.

## Phase 5 — Hardening & deployment

_First committed 2026-07-12._

- **Deploy targets:** web on Vercel, API on Render (blueprint in `render.yaml`,
  migrations run on every deploy), Postgres on Neon, optional Redis on Upstash — all
  free tiers. Full runbook: [docs/DEPLOYMENT.md](DEPLOYMENT.md).
- **Proxy-aware:** `trust proxy` in production so rate limits key on real client IPs.
- **Graceful shutdown:** SIGTERM drains in-flight requests and closes the database
  cleanly — deploys don't cut off upload parts mid-response.
- **Cross-site sessions:** refresh cookies switch to `SameSite=None; Secure` in
  production (Vercel ↔ Render are different sites; `Strict` would drop every session).
- **Account keep-alive:** a daily sweep pings storage connections untouched for 30+ days
  so the platform's inactivity rule never deletes a dormant user's account.
- **Client rate guardrails:** bounded upload concurrency, folder-upload thresholds, and
  a leave-page warning while uploads are in flight.

---

## Post-launch — production polish, PWA, mobile UX

_2026-07 onward, on the `claude/production-project-setup-lbrp9f` branch._

With the five phases complete, work shifted to production readiness on real devices —
observability, an installable mobile experience, and a long tail of mobile-interaction
and theming fixes. Highlights (see `/logs` for the day-by-day detail):

- **Analytics & error monitoring** (privacy-safe GA + Sentry), the `docs/DATABASE.md`
  anti-staleness system, and multi-select zip downloads / one-connection downloads
  (2026-07).
- **Installable PWA:** opt-in install (Settings only, no auto-popup), a service worker
  with a friendly offline page, a single continuous launch screen, raster-only manifest
  icons so Android draws the real splash, and reliable update delivery (2026-09-21+).
- **Mobile interaction pass:** responsive fixes for drive/panels/modals, per-row actions
  collapsed into an overflow menu, long-press-to-select on touch with no permanent
  checkboxes, exclusive accordions, roomier gutters (2026-09-21).
- **Session durability & PWA chrome:** sessions survive server restarts; system
  status/navigation bars follow the in-app theme on Android 15+ edge-to-edge; the app is
  locked to dark mode with iOS launch images and an in-app update prompt (2026-09-22/23).
- **Reliability & UX fixes:** password-reset email delivery logging without leaking the
  address or link; a fix for client-side navigations crashing after sign-in; Move added
  to the multi-select action bar; grid-card checkbox no longer covers the icon;
  tap-to-select made reliable across the whole card, including the dead zone around the
  overflow-menu button (2026-09-23/26/27).

---

## Keeping this file current

Update this file when a **milestone or a new phase/workstream** lands — not for every
change (those go in `/logs`). A good rule: if it changes the shape of the product or how
you'd describe the project to a new contributor, add or extend a section here. The
routine, change-by-change record belongs in `/logs/YYYY-MM-DD.md`. See
[`CLAUDE.md`](../CLAUDE.md) for the exact read-first / update-after workflow.
