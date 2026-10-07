# ADR-0003: Connect with a user-account MTProto client (GramJS) behind a gateway interface

**Status:** Accepted · July 2026 · Phase 2

## Context

ADR-0002 puts bytes in the user's Telegram account, which requires a programmatic
Telegram client. Two client styles exist:

1. **Bot API.** Simple HTTP, but bots can't act as a personal account, and the
   Bot API caps file downloads at 20 MB and uploads at 50 MB — fatal for a file
   store meant to hold multi-GB files in the _user's own_ account.
2. **User-account MTProto client.** Logs in as the user (phone → code → optional
   2FA), can create channels in their account, and moves files up to the ~2 GB
   per-message limit. Libraries: GramJS (Node/TypeScript) or TDLib (native).

A second concern is **testability and blast radius**: the rest of the backend
must never depend on a concrete Telegram library, so it can be faked in tests
and swapped if needed.

## Decision

Use a **user-account MTProto client via GramJS**, and put it **behind a
`TelegramGateway` interface** (`apps/api/src/lib/telegram/gateway.ts`). The GramJS
adapter (`gramjs.ts`) implements the interface; tests substitute a fake
(`test-utils/fake-gateway.ts`). Only the gateway speaks MTProto; services depend
on the interface.

## Consequences

- Supports the restart-safe login flow (phone/OTP/2FA) and multi-GB transfers
  that the Bot API cannot.
- **Session strings are high-value secrets** → encrypted at rest (see ADR-0001).
- **FLOOD_WAIT and rate limits are first-class:** short waits are absorbed with
  retry, long ones surface as honest `429`s with `retryAfterSeconds`, and a
  **per-user mutex** serialises all storage operations for one account.
- The whole data path is **mockable in tests** — the full upload → store →
  download round-trip is tested against the fake gateway, with no network.
- Swapping libraries (or adding TDLib later) means writing one adapter, not
  touching services.
