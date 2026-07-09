# Pocketverse

> A whole universe in your pocket — a Drive-style interface over storage **you** control.

Pocketverse gives you a calm, familiar file manager (folders, search, previews) backed by your own
private cloud storage account. Your files never sit on our servers; we hold only encrypted
metadata and connection credentials, and we're honest with you about exactly what we can and
cannot see.

**Status:** Phase 4 of 5 — the Drive UI and trust surfaces. 🚧 Built in public.

## Monorepo layout

```
apps/api        Express + TypeScript API (auth, encryption core, — later — storage engine)
apps/web        Next.js app (auth pages now; the Drive UI lands in Phase 4)
packages/shared Zod schemas and types shared by both
```

## Security design (Phase 1 scope)

- **Envelope encryption** (AES-256-GCM, Node `crypto` only): a master keyring from env wraps
  per-user data keys; every ciphertext is bound to its context via AAD so values can't be swapped
  between rows. Multi-key keyring → master key rotation without downtime
  (`apps/api/src/lib/crypto`).
- **Passwords** hashed with argon2id (OWASP parameters). Identical errors for unknown email vs
  wrong password.
- **Tokens:** 15-minute access JWTs (jose, HS256) + 30-day rotating refresh tokens stored only as
  SHA-256 hashes, delivered as `httpOnly` `SameSite=Strict` cookies. Reused (stolen) refresh
  tokens revoke the whole session family.
- **Logging:** Pino with hard redaction of passwords, tokens, sessions, and key material —
  enforced by tests (`apps/api/src/lib/logger.test.ts`).
- No secrets in git — everything comes from env (`.env.example` documents each variable).

## Storage connection (Phase 2)

- **MTProto user client (GramJS)** behind a `TelegramGateway` interface
  (`apps/api/src/lib/telegram/`): phone → OTP → optional 2FA login, then a private
  "Pocketverse Storage" channel is created in the user's account.
- **Restart-safe login:** the multi-step flow survives server sleeps — intermediate state is an
  encrypted blob in Postgres (10-minute TTL), never a live object in RAM.
- **Session strings** are envelope-encrypted per connection (AAD-bound to the user), redacted
  from logs, and never serialized into any API response — enforced by tests.
- **FLOOD_WAIT handling:** short waits are absorbed with retry; long ones surface as honest
  429s with `retryAfterSeconds`. Per-user mutex serializes all storage operations.
- **Design record:** [ADR-0001](docs/adr/0001-session-key-encryption.md) — why sessions use a
  server-side master keyring (and why password-derived keys are a v2 opt-in, not the default).

## Storage engine (Phase 3)

- **Resumable uploads:** the client sends files in small sequential parts (8 MB default) that
  stream to disk staging — an interrupted upload resumes from the last acknowledged part, and
  the server tells the client exactly where to resume after a restart (`STAGING_LOST` → new
  cursor). Progress shown in the UI is parts the server has confirmed, never an estimate.
- **Chunking:** files are stored as ≤1.5 GB chunks (configurable), one channel message each;
  per-chunk sha256 checksums plus a whole-file checksum are recorded. Downloads stream chunk by
  chunk straight to the response — file bytes are never buffered in RAM and never persisted on
  the server beyond transient staging.
- **Queue:** every transfer runs as a job with exponential-backoff retries (FLOOD_WAIT-aware).
  With `REDIS_URL` set jobs run on BullMQ (survive restarts); without it an in-process runner
  applies the same policy — fine for local dev and single instances.
- **Folders:** full CRUD with move/rename, cycle-proof moves, duplicate-name protection, and
  recursive delete that also removes the chunk messages from the user's storage.
- Deleting anything deletes it from the user's storage too — stated plainly in the UI before
  confirming, never silently.

## Drive UI & trust surfaces (Phase 4)

- **Design system:** deep-space, dark-mode-first tokens (color, spacing, type, motion) with a
  clean light theme and a persisted toggle; Space Grotesk + Inter (self-hosted, no external font
  fetch); an inline SVG icon set — no icon library. See `apps/web/src/app/globals.css`.
- **File browser:** grid/list toggle, breadcrumbs, drag-and-drop upload (react-dropzone) with
  **real** acknowledged-parts progress and **pause/resume** (the server's resume cursor makes it
  free), per-file status badges with live sync %, inline image/PDF previews, move-to-folder
  dialog, and designed empty/loading/error states.
- **Search** across your whole drive (`GET /api/files/search`), with the containing folder shown.
- **Honest onboarding:** the `/connect` wizard leads with a full disclosures screen — the "what
  we never do" list, inactivity-deletion warning, and ToS note — gated by a real (unchecked)
  "I understand" checkbox before any connection begins.
- **Security page** (`/security`): plain-language explanation of the encryption model and, per
  ADR-0001, an honest statement of what the server can and cannot decrypt — no false
  zero-knowledge claims.
- **Activity log** (`/activity`): the audit events recorded since Phase 2, in friendly language
  with relative timestamps and cursor pagination.

## Local development

Requirements: Node ≥ 22, pnpm ≥ 10, and Postgres (any local instance or a free
[Neon](https://neon.tech) database).

One `.env` at the **repo root** drives everything: the API loads it on boot (a package-local
`apps/api/.env` wins if both exist), and the Prisma scripts read it too. No local Postgres?
A free [Neon](https://neon.tech) database works — paste its connection string as `DATABASE_URL`.

```bash
pnpm install
cp .env.example .env        # fill in DATABASE_URL, JWT_SECRET, MASTER_KEYS, TELEGRAM_API_*
# generate secrets:
#   openssl rand -base64 48                                        → JWT_SECRET
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  → MASTER_KEYS value
# TELEGRAM_API_ID / TELEGRAM_API_HASH: create once at https://my.telegram.org
# (API development tools) — they identify the app, not any user account.

pnpm --filter @pocketverse/api prisma:migrate   # create tables
pnpm build                                       # builds shared → api → web
pnpm dev                                         # api on :4000, web on :3000
```

### Quality gates

```bash
pnpm lint        # eslint (flat config, workspace-wide)
pnpm typecheck   # tsc --noEmit in every package
pnpm test        # vitest — crypto, jwt, logger-redaction, auth API suites
pnpm build       # shared (tsc), api (tsc), web (next build)
```

CI (GitHub Actions) runs all four on every PR. Husky + lint-staged keep commits clean locally.

### Troubleshooting

**`prisma generate` fails with `EPERM: operation not permitted, rename …` (Windows).**
This is a file lock, not a code error — a running process is holding the Prisma query-engine DLL
inside `node_modules`. It only matters when the Prisma **schema** changed; if a `git pull` only
touched source files, your existing generated client is still valid and you can skip it. To clear
it: stop the dev server (`Ctrl+C`, or `taskkill /F /IM node.exe` to kill all Node), close/reload
your editor if it's open on the repo, then run `pnpm --filter @pocketverse/api exec prisma generate`.

### Manually verifying the storage connection

The connection flow talks to real Telegram servers, so CI covers it with a fake gateway; verify
the real thing locally: run `pnpm dev`, register at `http://localhost:3000/register`, open
`/connect`, enter your phone in international format, then the code Telegram sends you (and your
2FA password if enabled). A private "Pocketverse Storage" channel appears in your account and
`/drive` shows the connection badge. `DELETE /api/connection` (or a later UI control) disconnects
and invalidates the session remotely — the channel and its contents stay in your account.

## Roadmap

| Phase | Scope                                                               | Status         |
| ----- | ------------------------------------------------------------------- | -------------- |
| 1     | Monorepo, encryption core, user auth                                | ✅             |
| 2     | Storage connection (private channel, encrypted sessions, ADR)       | ✅             |
| 3     | Streaming upload/download engine, chunking, folder CRUD             | ✅             |
| 4     | Drive UI — design system, browser, honest onboarding, security page | ✅ this branch |
| 5     | Hardening, deploy (Vercel + Render/Koyeb + Neon + Upstash), runbook | ⏳             |
