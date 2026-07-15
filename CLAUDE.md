# Pocketverse — repo guide for Claude

Google-Drive-style app that uses the user's own Telegram account as unlimited
storage. pnpm monorepo:

- `apps/api` — Express 5 + TypeScript, Prisma/PostgreSQL, MTProto (GramJS)
- `apps/web` — Next.js 15 App Router, TanStack Query, Zustand
- `packages/shared` — Zod schemas/types shared by both

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

- `docs/DATABASE.md` — data model + API-to-table reference (keep fresh; see above)
- `docs/DEPLOYMENT.md` — free-tier deploy runbook (Vercel + Render + Neon)
- `docs/adr/` — architecture decision records
- `README.md` — phase-by-phase feature overview
