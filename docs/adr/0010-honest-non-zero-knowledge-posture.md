# ADR-0010: Honest, non-zero-knowledge security and data-loss posture

**Status:** Accepted · July 2026 · Phase 2 & 4

## Context

Because background jobs must run while the user is logged out, the server **can
technically decrypt** a connection session to do that work (ADR-0001). Many
products would still market themselves as "zero-knowledge" or "end-to-end
encrypted." Storing bytes in the user's own Telegram account (ADR-0002) also
introduces real, user-caused loss vectors that a marketing site would hide.

The decision is about **product honesty as an architectural principle**, not a
single mechanism.

## Decision

**Tell the user the truth, in plain language, and build the surfaces to do it.**

- The `/security` page states exactly **what the server can and cannot see** —
  no false zero-knowledge claim — per ADR-0001.
- The `/connect` onboarding leads with a full disclosures screen (the "what we
  never do" list, the Telegram inactivity-deletion warning, the ToS gray-area
  note), gated by a real "I understand" checkbox before any connection begins.
- Every loss vector is explained **and logged**: Telegram inactivity deletion,
  disconnecting, and hand-deleting channel messages each surface in the UI and
  the activity log.
- Storage figures and states are honest: "unlimited" is explained; a deleted
  file reads **"unavailable,"** not "stored" (ADR-0011); storage totals count
  only data that is actually available.

## Consequences

- Copy and claims are a **reviewed part of the architecture** — the "never call
  it zero-knowledge" rule lives in `CLAUDE.md` and ADR-0001.
- Trust surfaces (`/security`, `/connect`, `/about`, `/activity`) are
  first-class features, not afterthoughts.
- A future **"paranoid mode"** (password-derived keys) stays a viable opt-in for
  users who accept losing background sync (ADR-0001).
