# ADR-0009: Free-tier deployment topology (Vercel + Render + Neon + optional Upstash)

**Status:** Accepted · July 2026 · Phase 5

## Context

A goal of the project is to run a real, production-shaped deployment at **zero
cost**. That constraint shapes the hosting choices and forces the app to behave
well under free-tier limits (cold starts, idle suspension, short timeouts,
small instances).

## Decision

- **Web → Vercel** (Next.js native host).
- **API → Render** (Docker/Node web service; `render.yaml` blueprint; migrations
  run on every deploy via `prisma migrate deploy`).
- **Postgres → Neon** (serverless Postgres; suspends when idle).
- **Redis → Upstash, optional** (only if durable queues are wanted; the app runs
  without it, see ADR-0005).

## Consequences

The free tier dictates several architectural behaviours, all documented in
`docs/DEPLOYMENT.md`:

- **Neon idle-suspend:** the `DATABASE_URL` must use `connect_timeout=15` so
  Prisma waits for the compute to wake instead of failing with `P1001`.
- **Proxy awareness:** `trust proxy` in production so rate limits key on the real
  client IP, not the load balancer's.
- **Graceful shutdown:** SIGTERM drains in-flight requests and closes the DB
  cleanly, so a deploy doesn't cut off an upload part mid-response.
- **Cross-site cookies** (ADR-0006/0007) because web and API are different hosts.
- **Streaming, memory-flat transfers** (ADR-0004) because instances are small.
- This topology is a deliberate _default_, not a lock-in: each piece is swappable
  because the app depends on interfaces/env, not the host.
