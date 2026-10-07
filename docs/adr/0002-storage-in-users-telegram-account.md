# ADR-0002: Files live in the user's own Telegram account, we store only metadata

**Status:** Accepted · July 2026 · Phase 1–2 (foundational)

## Context

Pocketverse is a Drive-style file manager. The defining question is **where the
file bytes live**. A conventional product would rent object storage (S3, R2,
Backblaze) and pass the cost on — but the goal here was genuinely unlimited
storage at zero marginal cost, owned by the user, on free-tier infrastructure.

Options considered:

1. **Our own object storage** (S3/R2/etc.). Predictable, but we pay per GB and
   per request, we hold the user's bytes (a liability), and "unlimited" becomes
   a bill.
2. **The user's own cloud-drive account** (Google Drive / Dropbox via OAuth).
   Capped by the user's quota; not "unlimited"; heavy per-provider integration.
3. **The user's own Telegram account.** A private channel in a personal Telegram
   account has no total-size cap, the user owns the account, and bytes never
   touch our servers. Telegram caps a _single_ upload at ~2 GB, not the total.

## Decision

**Option 3.** File bytes are stored as messages in a private
**"Pocketverse Storage"** channel inside the **user's own Telegram account**.
Our database holds **only metadata** (names, sizes, folder tree, chunk → message
mapping, checksums) and the encrypted connection credential. No file byte is
ever written to our database or persisted on our disks beyond transient upload
staging.

## Consequences

- **Genuinely unlimited, user-owned storage** at no marginal cost to us, which
  is the product's core promise.
- **The 2 GB per-message limit forces chunking** (see ADR-0004) — large files
  are split and reassembled transparently.
- **Terms-of-service gray area:** using a personal account as bulk storage sits
  outside Telegram's intended use. We surface this honestly on `/connect` and
  `/security` rather than hiding it (see ADR-0010).
- **New loss vectors we must manage and disclose:** Telegram's inactivity-based
  account deletion, the user disconnecting, and the user hand-deleting messages
  in the channel. Each is explained in the UI and written to the activity log;
  hand-deletion is handled as the `LOST` file state (see ADR-0011).
- **We need an MTProto user client** (not the Bot API) to create the channel and
  move multi-GB files (see ADR-0003).
- The golden rule **"no file bytes in our database or on our servers"** flows
  directly from this ADR and is enforced throughout the codebase.
