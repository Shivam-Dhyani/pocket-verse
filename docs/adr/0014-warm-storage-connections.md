# ADR-0014: Warm, reused storage connections for transfers

**Status:** Accepted · October 2026 · post-launch (performance)

## Context

Small uploads were slow: a 3-image, 3.4 MB folder took 30+ seconds. Reading the
transfer path showed why — every **chunk** opened its own Telegram connection
and tore it down afterwards:

1. TCP to the account's data centre + MTProto init with a config fetch;
2. a **second** connection GramJS opens just for file parts (`getSender(dcId)`
   → `_borrowExportedSender`), preceded by **another** config fetch, because a
   brand-new client has nothing cached;
3. the file parts, then the message post;
4. destroy everything.

That is several round trips before a single byte moves, paid once per file and
— because the per-user lock (ADR-0003) runs an account's transfers one at a
time — paid **serially** across a folder. On the free tier the API runs in
Render's default Oregon region, so each of those round trips crosses to a
Telegram data centre an ocean away. Measured separately, MTProto encryption
itself (pure-JS AES-IGE in GramJS) costs under a second for 3.4 MB even on a
0.1-CPU instance — the cost was latency, not CPU or bandwidth.

The original design ("one connected client per operation", from when the only
calls were occasional account operations) assumed long-lived sockets bought
nothing on a free tier that sleeps.

## Decision

- **A warm connection per account for transfers.** Chunk uploads and message
  deletes acquire a connected client from a small in-memory pool keyed by a
  hash of the session, and release it afterwards. It stays open for 60 s after
  its last use, which spans the gaps between a folder's files; GramJS's own
  upload connection stays alive between them too.
- **Prewarm on upload start.** `createUpload` asks the gateway to open the
  connection in the background while the browser is still sending bytes, so the
  first chunk doesn't wait on connection setup either.
- **Fail clean.** A connection that fails an operation, dropped while idle, or
  belongs to a session that logs out is retired; the retry opens a fresh one.
  Pool timers are `unref()`'d and the pool is closed on graceful shutdown.
- **Per-account serialization is unchanged.** Transfers for one account still
  run one at a time (ADR-0003) — the FLOOD_WAIT protection stays; only the
  per-file setup cost goes away.
- Account-level calls (login, health checks, channel creation, log-out) keep
  short-lived connections; downloads keep their own per-download connection.

## Consequences

- Per-file connection setup is paid **once per upload burst** instead of once
  per file, and overlapped with the browser upload — the biggest code-side win
  for folders of small files.
- Timing is observable: the worker logs `waitedMs` (queued behind the account's
  other transfers), `transferMs`, and `reusedConnection`, so slow uploads can be
  attributed to code vs. hosting from Render's logs.
- Up to one idle socket per recently-active account for 60 s — negligible.
- **What code can't fix is documented, not hidden:** cold starts and the
  distance between the phone, Render, Neon and Telegram dominate small uploads;
  `docs/DEPLOYMENT.md` ("Upload speed") covers region co-location and keeping
  the API warm.
- Possible next step if large folders still feel slow: allow a small, bounded
  number of parallel transfers per account (with FLOOD_WAIT back-off), which
  would revise ADR-0003.
