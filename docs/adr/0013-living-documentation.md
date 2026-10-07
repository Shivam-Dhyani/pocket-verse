# ADR-0013: Living documentation — journey, logs, ADRs, and a freshness guard

**Status:** Accepted · September–October 2026 · post-launch

## Context

A project built in phases over time loses the _why_ behind its code unless the
reasoning is written down where the next contributor (human or AI) will read it.
Code comments explain local intent; they don't capture the arc of the project or
the decisions behind it. We want anyone picking this up to get full context
_before_ changing code, and to record what they did _after_.

## Decision

A small system of living documents, each with one job:

- **`docs/DEVELOPMENT_JOURNEY.md`** — the phase-by-phase narrative of how the
  project was built.
- **`logs/YYYY-MM-DD.md`** — a dated record of every change, fix (with root
  cause), and decision, written the day it happens.
- **`docs/adr/`** — Architecture Decision Records: the significant decisions and
  their rejected alternatives (this folder).
- **`docs/DATABASE.md`** — the live data-model + API↔table reference, kept fresh
  by the `pnpm docs:check-db` pre-commit guard and the `db-architecture-doc`
  skill. Its diagram is a rendered image so it previews anywhere.
- **`docs/DEPLOYMENT.md`**, **`docs/PWA.md`**, **`README.md`** — the deploy
  runbook, PWA behaviour, and standard project readme.

`CLAUDE.md` codifies the workflow: **read** the journey + recent logs before
changing code; **record** after — always a log entry, and update whichever docs
the change touches (ADR for an architectural decision, DATABASE.md for data/API,
DEPLOYMENT/PWA/README as relevant), with the journey updated for milestones.

## Consequences

- Context is **durable and discoverable**, not trapped in one person's memory or
  the git log alone.
- Keeping docs current is **part of the change, not optional cleanup** — enforced
  by convention (CLAUDE.md) and, for the data model, by an automated guard.
- A small ongoing cost per change, paid back every time someone needs to
  understand why something is the way it is.
