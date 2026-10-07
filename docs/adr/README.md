# Architecture Decision Records

Short documents recording **significant architecture decisions**, their context,
and the alternatives that were rejected — so anyone (human or AI) can read how
and why Pocketverse is shaped the way it is, in the order the decisions were made.

Read these alongside [`docs/DEVELOPMENT_JOURNEY.md`](../DEVELOPMENT_JOURNEY.md)
(the narrative) and [`docs/DATABASE.md`](../DATABASE.md) (the data model).

| #    | Title                                                                                                | Status   | When        |
| ---- | ---------------------------------------------------------------------------------------------------- | -------- | ----------- |
| 0001 | [Session strings: server-side master keyring](./0001-session-key-encryption.md)                      | Accepted | Phase 2     |
| 0002 | [Files live in the user's own Telegram account](./0002-storage-in-users-telegram-account.md)         | Accepted | Phase 1–2   |
| 0003 | [User-account MTProto client behind a gateway](./0003-mtproto-user-client-behind-gateway.md)         | Accepted | Phase 2     |
| 0004 | [Chunked, resumable, streaming transfers](./0004-chunked-resumable-streaming-transfers.md)           | Accepted | Phase 3     |
| 0005 | [Pluggable background queue (BullMQ or in-process)](./0005-pluggable-background-queue.md)            | Accepted | Phase 3     |
| 0006 | [Token auth — access JWT + rotating refresh](./0006-token-auth-access-jwt-rotating-refresh.md)       | Accepted | Phase 1     |
| 0007 | [Same-origin auth proxy for cross-site sessions](./0007-same-origin-auth-proxy.md)                   | Accepted | post-launch |
| 0008 | [pnpm monorepo with a shared Zod contract](./0008-pnpm-monorepo-shared-contract.md)                  | Accepted | Phase 1     |
| 0009 | [Free-tier deployment topology](./0009-free-tier-deployment-topology.md)                             | Accepted | Phase 5     |
| 0010 | [Honest, non-zero-knowledge posture](./0010-honest-non-zero-knowledge-posture.md)                    | Accepted | Phase 2 & 4 |
| 0011 | [Distinct "lost" file state + download pre-flight](./0011-lost-file-state-and-download-preflight.md) | Accepted | post-launch |
| 0012 | [Installable PWA, dark-mode lock, update prompt](./0012-installable-pwa-dark-lock.md)                | Accepted | post-launch |
| 0013 | [Living documentation](./0013-living-documentation.md)                                               | Accepted | post-launch |

## Writing a new ADR

Add one whenever a decision changes the **shape** of the system — a new
dependency or external service, a data-model or protocol change, an auth/security
choice, a deployment-topology change, or anything a future contributor would be
surprised by without the reasoning.

1. Copy the structure below into `NNNN-short-title.md` (next number, zero-padded).
2. Fill in **Context** (the forces and the options considered), **Decision**
   (what was chosen), and **Consequences** (what it buys and what it costs).
3. Add a row to the table above.
4. If a new decision **supersedes** an older one, set the old ADR's status to
   `Superseded by ADR-NNNN` (and link back) rather than deleting it — ADRs are a
   history, not a snapshot.

```markdown
# ADR-NNNN: <short imperative title>

**Status:** Proposed | Accepted | Superseded by ADR-NNNN · <month year> · <phase/context>

## Context

<The forces at play and the options considered.>

## Decision

<What was chosen, and the essentials of how.>

## Consequences

<What this buys, what it costs, and what it forces elsewhere.>
```
