# ADR-0008: pnpm monorepo with a shared Zod contract package

**Status:** Accepted · July 2026 · Phase 1

## Context

The product is a TypeScript API plus a TypeScript web app that exchange the same
request/response shapes. Keeping those shapes in sync across two repos (or two
unrelated packages) invites drift: a renamed field breaks the client silently.

## Decision

A single **pnpm workspace monorepo** with three packages:

- `apps/api` — Express 5 + Prisma backend.
- `apps/web` — Next.js 15 frontend.
- `packages/shared` — **Zod schemas and the types inferred from them**, imported
  by both sides as `@pocketverse/shared`.

Validation and types come from **one source**: the API validates requests with a
schema; the web infers its types from the same schema. Build order is
`shared → api → web`.

## Consequences

- **The client and server can't disagree about a DTO** — a schema change surfaces
  as a type error on both sides.
- Runtime validation (API boundary) and compile-time types (both apps) are the
  same definitions, not parallel hand-maintained copies.
- `shared` must be built before the apps type-check or build (handled by the
  `prebuild` scripts and the root build order).
