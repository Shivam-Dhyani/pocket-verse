# ADR-0011: Distinct "lost" file state and a download pre-flight

**Status:** Accepted · September 2026 · post-launch (data integrity)

## Context

Because bytes live in the user's Telegram account (ADR-0002), a user can
**hand-delete** a file's messages there. Originally such a file was conflated
with a failed upload: both became `ERROR`, both read "upload failed," and the
loss was only discovered when a download **broke mid-stream** — handing the
browser a corrupt, partial file. "Upload failed" and "you deleted this from your
storage" are genuinely different situations with different honest messaging and
different recovery.

## Decision

- **A distinct `LOST` file state**, separate from `ERROR` (upload failed). A file
  that was fully stored and then had its data deleted is `LOST` — badge
  **"unavailable,"** error `410 FILE_UNAVAILABLE`, and the only action is
  **Remove** (clear the dead entry). LOST data is excluded from storage totals.
- **A download pre-flight:** `download()` verifies every chunk message still
  exists **before any response headers are committed**. Missing → mark `LOST` +
  log + clean error, never a corrupt partial download.
- **Classification by evidence:** the two are told apart by whether the file was
  _ever fully stored_ (`wasFullyStored` = every chunk has a storage message id).
  A fully-stored file whose data is gone is `LOST`; one that never reached
  storage stays `ERROR` (upload failed, offer retry). This lets files wrongly
  stuck in `ERROR` self-heal on the next download or "retry sync."

## Consequences

- Users get an honest, distinct explanation and the one useful action for a
  deleted file, instead of a misleading "upload failed."
- No more corrupt partial downloads for a deleted file.
- The `file.unreachable` audit event records every loss.
- **Known gaps (recorded, not yet built):** zip/multi-select download does not
  yet pre-flight per file; detection is still lazy (on access) rather than a
  proactive reconciliation sweep.
