# Pocketverse

> A whole universe in your pocket — a Drive-style interface over storage **you** control.

Pocketverse gives you a calm, familiar file manager (folders, search, previews) backed by
your own private cloud storage account. Your files never sit on our servers; we hold only
encrypted metadata and connection credentials, and we're honest about exactly what we can
and cannot see.

## Features

- **A real drive:** grid/list views, folders with move/rename, breadcrumbs, drag-and-drop
  upload, whole-folder upload, search, inline image/PDF previews, and multi-select
  download / move / delete.
- **Unlimited storage you own:** files live in a private channel in your own storage
  account; large files are split and reassembled transparently, so nothing is rejected for
  size.
- **Resumable transfers:** uploads stream in small parts and resume from the last
  acknowledged part after an interruption; downloads stream straight through the browser's
  native download manager and never buffer in memory.
- **Honest security:** envelope encryption for credentials, argon2id passwords, rotating
  refresh tokens, and a plain-language `/security` page that states exactly what the
  server can and cannot decrypt — no false zero-knowledge claims.
- **Installable PWA:** opt-in install, an offline page, a continuous launch screen, and an
  in-app update prompt.

## Tech stack

Next.js 15 (App Router) · TanStack Query · Zustand · Express 5 · TypeScript · Prisma /
PostgreSQL · GramJS (MTProto) · Zod. pnpm monorepo.

## Monorepo layout

```
apps/api          Express + TypeScript API — auth, encryption core, storage engine, MTProto client
apps/web          Next.js app — Drive UI, onboarding, trust surfaces
packages/shared   Zod schemas and types shared by both
```

## Getting started

Requirements: Node ≥ 22, pnpm ≥ 10, and Postgres (any local instance or a free
[Neon](https://neon.tech) database).

One `.env` at the **repo root** drives everything: the API loads it on boot (a
package-local `apps/api/.env` wins if both exist), and the Prisma scripts read it too.

```bash
pnpm install
cp .env.example .env        # fill in DATABASE_URL, JWT_SECRET, MASTER_KEYS, TELEGRAM_API_*
# generate secrets:
#   openssl rand -base64 48                                                       → JWT_SECRET
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   → MASTER_KEYS value
# TELEGRAM_API_ID / TELEGRAM_API_HASH: create once at https://my.telegram.org
# (API development tools) — they identify the app, not any user account.

pnpm --filter @pocketverse/api prisma:migrate   # create tables
pnpm build                                       # builds shared → api → web
pnpm dev                                         # api on :4000, web on :3000
```

## Scripts & quality gates

```bash
pnpm lint        # eslint (flat config, workspace-wide)
pnpm typecheck   # tsc --noEmit in every package
pnpm test        # vitest — crypto, jwt, logger-redaction, auth API suites
pnpm build       # shared (tsc), api (tsc), web (next build)
pnpm format      # prettier --write
```

CI (GitHub Actions) runs lint, typecheck, test, and build on every PR. Husky + lint-staged
keep commits clean locally. The `pnpm docs:check-db` pre-commit guard warns when backend
changes are staged without updating `docs/DATABASE.md`.

## Deployment

Web on Vercel, API on Render (blueprint in `render.yaml`), Postgres on Neon, optional Redis
on Upstash — all free tiers. Full runbook with env tables, a verification checklist, and
troubleshooting: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Documentation

| Doc                                                          | What it covers                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [`docs/DEVELOPMENT_JOURNEY.md`](docs/DEVELOPMENT_JOURNEY.md) | How the project was built, phase by phase — the narrative history.      |
| [`logs/`](logs/)                                             | Day-by-day record of every change, fix, and decision (`YYYY-MM-DD.md`). |
| [`docs/DATABASE.md`](docs/DATABASE.md)                       | Data model and API↔table reference (kept in sync with the code).        |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)                   | Free-tier deployment runbook.                                           |
| [`docs/PWA.md`](docs/PWA.md)                                 | PWA behaviour — install, offline, launch screen, updates, system bars.  |
| [`docs/adr/`](docs/adr/)                                     | Architecture decision records.                                          |
| [`CLAUDE.md`](CLAUDE.md)                                     | Repo guide and conventions for AI-assisted development.                 |

## Troubleshooting

**`prisma generate` fails with `EPERM: operation not permitted, rename …` (Windows).**
A file lock, not a code error — a running process is holding the Prisma query-engine DLL
inside `node_modules`. It only matters when the Prisma **schema** changed; if a `git pull`
only touched source files, your existing generated client is still valid. To clear it: stop
the dev server (`Ctrl+C`, or `taskkill /F /IM node.exe`), close/reload your editor if it's
open on the repo, then run `pnpm --filter @pocketverse/api exec prisma generate`.

**Verifying the storage connection locally.** The connection flow talks to real servers, so
CI covers it with a fake gateway. To verify the real thing: run `pnpm dev`, register at
`http://localhost:3000/register`, open `/connect`, enter your phone in international format,
then the code you're sent (and your 2FA password if enabled). A private "Pocketverse
Storage" channel appears in your account and `/drive` shows the connection badge.
`DELETE /api/connection` disconnects and invalidates the session remotely — the channel and
its contents stay in your account.
