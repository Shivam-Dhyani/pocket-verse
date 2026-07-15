---
name: db-architecture-doc
description: >-
  Keep docs/DATABASE.md — the backend data-model + API reference — in sync with
  the code. Invoke this whenever the Prisma schema
  (apps/api/prisma/schema.prisma) or any API route/service changes (files under
  apps/api/src/modules/**, or route mounting in apps/api/src/app.ts), and after
  adding a migration. Use it to update the doc in the SAME change so it never
  goes stale.
---

# Keeping `docs/DATABASE.md` fresh

`docs/DATABASE.md` is the single reference developers use to understand the
backend: every table, and the exact API endpoints that read/write each table,
plus end-to-end multi-table flows. It is a **living document** and must reflect
the code at all times.

## When to run

Update the doc in the same change that touches either side it documents:

- **Schema changed** — a model/field/enum/index/relation edited in
  `apps/api/prisma/schema.prisma`, or a new folder under
  `apps/api/prisma/migrations/`.
- **API changed** — a route added/removed/changed in any
  `apps/api/src/modules/**/*.routes.ts`, a service function that changes which
  tables an endpoint touches, or the route mounting/limiters in
  `apps/api/src/app.ts`.

## How to update it (procedure)

1. **Read the sources of truth** — never document from memory:
   - `apps/api/prisma/schema.prisma` (models, enums, indexes, relations).
   - `apps/api/src/app.ts` (which router mounts at which path + limiter).
   - Every `apps/api/src/modules/**/*.routes.ts` (the actual endpoints).
   - The matching `*.service.ts` to see which tables each endpoint reads/writes
     (look for `prisma.<model>.<op>` and `audit.record(...)`).
   - `apps/api/src/modules/files/storage.worker.ts` for background jobs
     (`chunk-upload`, `messages-delete`) — they touch tables too.
   - `apps/api/src/modules/audit/audit.service.ts` for the `AuditEventTypes`
     list.

2. **Reconcile each section of `docs/DATABASE.md`:**
   - **ER diagram** — add/remove entities and relationships.
   - **Per-table** — columns (type + constraint), relations, indexes, and the
     **"APIs that touch this table"** table. An endpoint appears under EVERY
     table it reads or writes (a delete that cascades chunks appears under both
     File and FileChunk).
   - **End-to-end flows** — if a change alters a multi-table operation, or adds
     a new one, update/add the numbered flow.
   - **AuditEvent** — keep the event-type list in sync with `AuditEventTypes`.

3. **Update the header comment's "Last verified" date** and keep the
   Maintaining-this-document section accurate.

4. **Verify:** run `pnpm docs:check-db` (staleness guard) — it should pass once
   the doc is updated alongside the code.

## Principles

- **Terse, not duplicative.** Document _what table_ and _which endpoints_ — do
  not re-explain business logic already commented in the services.
- **Accuracy over completeness.** A wrong entry is worse than a missing one;
  read the code, don't guess.
- **Every endpoint, every table.** The value of the doc is the table↔endpoint
  mapping being exhaustive.
