# ADR-0004: Chunked, resumable, streaming transfers — no bytes at rest

**Status:** Accepted · July 2026 · Phase 3

## Context

Three constraints collide: Telegram caps one message at ~2 GB; free-tier
request timeouts are short (a single multi-GB HTTP request won't finish); and we
promised not to keep user bytes (ADR-0002). Yet the product must handle large
files reliably over flaky mobile connections and across server restarts/redeploys.

## Decision

- **Chunking:** a file is split into **≤1.5 GB chunks** (`CHUNK_SIZE_BYTES`,
  configurable), one Telegram channel message each. Per-chunk SHA-256 plus a
  whole-file (composite) checksum are recorded.
- **Resumable part uploads:** the client sends each chunk as small sequential
  **parts (~8 MB, `UPLOAD_PART_SIZE_BYTES`)** streamed to disk staging. Progress
  shown is the parts the server has _acknowledged_, never an estimate. After an
  interruption or restart the server tells the client exactly where to resume
  (`STAGING_LOST` → new cursor).
- **Streaming downloads:** chunks are fetched in order and streamed straight to
  the response; **nothing is buffered in memory** beyond transport pieces, and
  nothing is persisted beyond the transient staging directory.

## Consequences

- Large files "simply take longer, they are never rejected."
- **Memory stays flat** regardless of file size — essential on a 512 MB free
  instance.
- Interrupted uploads resume cheaply; a re-dropped file continues where it left
  off. Staged bytes are deliberately kept after a failed sync so "retry sync"
  can finish the job (see also ADR-0011).
- Transfers must run as **retryable background jobs** (see ADR-0005), and a
  **download pre-flight** verifies chunk messages still exist before streaming
  (see ADR-0011).
- Added complexity: a staging directory, a resume protocol, and checksum
  bookkeeping — justified by reliability on constrained infra.
