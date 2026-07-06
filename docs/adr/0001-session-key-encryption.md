# ADR-0001: Session strings are encrypted with a server-side master keyring

**Status:** Accepted · July 2026 · Phase 2

## Context

A connected storage session string grants **full access to the user's entire storage account** —
leaking one is the worst thing this product can do. Session strings must be encrypted at rest,
and the encryption design determines what the server can do on the user's behalf.

Two designs were considered:

1. **Server-side master keyring (envelope encryption).** Each connection gets a random data key;
   the data key encrypts the session (AES-256-GCM, AAD-bound to the user); the data key is
   wrapped by a master key held only in server env. Multiple master keys can coexist, so
   rotation is: add key → flip active id → re-wrap → drop old key.
2. **Password-derived key ("paranoid mode").** The wrapping key is derived from the user's
   password via argon2id, so the server cannot decrypt sessions at all — only a logged-in
   request carrying the password-derived key can.

## Decision

**Option 1 — server-side master keyring** — implemented in `apps/api/src/lib/crypto`.

Option 2 is genuinely stronger against a full server compromise, but it makes every background
operation impossible while the user is logged out: scheduled health checks, queued uploads that
outlive a session (Phase 3), retry-after-FLOOD_WAIT jobs. Those background jobs are core to the
product working on free-tier infrastructure where requests time out and work must resume later.

## Consequences

- The master keyring is a single high-value secret: it lives only in env (`MASTER_KEYS`),
  supports rotation without downtime, and its compromise procedure belongs in the Phase 5
  runbook (rotate keys, re-wrap, force reconnects).
- We can and must promise honestly: sessions are encrypted at rest, unreadable in the database
  alone, never logged, never sent to a client — but "we technically cannot decrypt" would be a
  lie under this design, so the Security page must not claim it.
- **Paranoid mode remains a viable opt-in v2 feature** for users who accept losing background
  sync; the crypto module's envelope API was shaped so a password-derived wrapping key can be
  added without redesign (`unwrapDataKey` doesn't care where the wrapping key came from).
