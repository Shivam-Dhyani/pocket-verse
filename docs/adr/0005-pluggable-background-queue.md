# ADR-0005: Background work via a pluggable queue (BullMQ or in-process)

**Status:** Accepted · July 2026 · Phase 3

## Context

Transfers (chunk upload, message deletion) and periodic jobs (account keep-alive)
must run as retryable background work that survives the request that started it —
uploads outlive a session, FLOOD_WAIT means "try again later," and deploys
restart the process. A durable queue (BullMQ on Redis) is the standard answer,
but **Redis is not free on every free-tier setup**, and forcing it would block
local development and single-instance deploys.

## Decision

Define one queue abstraction with two interchangeable backends:

- **With `REDIS_URL` set → BullMQ.** Jobs are durable and survive restarts;
  correct for production and multi-instance.
- **Without it → an in-process runner** applying the **same retry/backoff policy**
  (FLOOD_WAIT-aware). Fine for local dev and a single instance.

Services enqueue against the abstraction and never know which backend runs.

## Consequences

- **Zero required infrastructure for dev**; Redis is an opt-in upgrade, not a
  prerequisite.
- Both paths share one retry policy, so behaviour is consistent; only durability
  across restarts differs.
- The in-process runner's jobs are lost on restart — acceptable for its use, and
  resumable uploads + "retry sync" recover the user-visible work anyway.
