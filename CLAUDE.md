# Pocketverse — repo guide for Claude

Google-Drive-style app that uses the user's own Telegram account as unlimited
storage. pnpm monorepo:

- `apps/api` — Express 5 + TypeScript, Prisma/PostgreSQL, MTProto (GramJS)
- `apps/web` — Next.js 15 App Router, TanStack Query, Zustand
- `packages/shared` — Zod schemas/types shared by both

## Development context workflow — read first, record after

This repo keeps a written memory of its own development. Use it every time.

**Before changing any code, read for context:**

1. [`docs/DEVELOPMENT_JOURNEY.md`](docs/DEVELOPMENT_JOURNEY.md) — the phase-by-phase
   narrative of how the project was built and why it's shaped the way it is.
2. The most recent files in [`logs/`](logs/) (`logs/YYYY-MM-DD.md`) — the day-by-day
   record of recent changes, fixes, and their root causes. Skim the latest few so you
   don't re-break something that was already fixed or re-litigate a settled decision.

**After finishing your work, record it — same change, before you're done:**

1. **Always** update the log for today's date: `logs/YYYY-MM-DD.md`. Create the file if
   it doesn't exist yet (copy the template in [`logs/README.md`](logs/README.md));
   **append** a new `##` section if it does. Write what changed, why (root cause for a
   fix), which areas/files, and how you verified it. This is non-negotiable for any code
   change.
2. **Only if the change is a milestone** — a new phase/workstream, or something that
   changes the shape of the product or how you'd describe it to a new contributor —
   also add or extend a section in `docs/DEVELOPMENT_JOURNEY.md`. Routine changes do
   **not** go in the journey; they live only in the log.

Logs are append-only history: don't rewrite past logs to match later reality. If
something changes or is reversed, record that in the log for the day it changed.

## Golden rules

- **Keep `docs/DATABASE.md` in sync — non-negotiable.** It is the living
  reference for the backend data model and the table↔endpoint map. Whenever you
  change **any** of these, update `docs/DATABASE.md` in the **same change**:
  - `apps/api/prisma/schema.prisma` or a new folder in `apps/api/prisma/migrations/`
  - any `apps/api/src/modules/**/*.routes.ts` or `*.service.ts`
  - route mounting / limiters in `apps/api/src/app.ts`

  Follow the `db-architecture-doc` skill (`.claude/skills/db-architecture-doc/`)
  for the exact procedure. The pre-commit `pnpm docs:check-db` guard warns if
  backend files are staged without the doc.

- **No file bytes in our database or on our servers.** Only metadata; bytes live
  in the user's Telegram channel.
- **No secrets in code or git** — env only. Session strings, tokens, and keys
  are envelope-encrypted at rest and must never be logged or returned in a DTO.
- **Never say a platform name (Telegram) in user-facing branding as "storage
  platform"** where the product should read as the user's own account — but DO
  name Telegram plainly where the user needs to understand what they connect to
  (see existing copy on `/connect`, `/security`, `/about`).

## Quality gates (run before committing non-trivial changes)

```bash
pnpm typecheck && pnpm lint && pnpm --filter @pocketverse/api test && pnpm --filter @pocketverse/web build
```

## Docs map

- `docs/DEVELOPMENT_JOURNEY.md` — phase-by-phase build history (read first; see above)
- `logs/` — day-by-day record of every change (read recent; record after; see above)
- `docs/DATABASE.md` — data model + API-to-table reference (keep fresh; see above)
- `docs/DEPLOYMENT.md` — free-tier deploy runbook (Vercel + Render + Neon)
- `docs/PWA.md` — PWA behaviour (install, offline, launch screen, updates, system bars)
- `docs/adr/` — architecture decision records
- `README.md` — standard project readme (what it is, setup, scripts, docs map)
