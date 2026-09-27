# Development logs

A running, date-stamped record of everything that changes in this repository — every
feature, fix, refactor, and decision — written on the day it happens.

## Why this exists

These logs are the project's memory. Before starting new work, a developer (or Claude)
reads the recent logs plus [`docs/DEVELOPMENT_JOURNEY.md`](../docs/DEVELOPMENT_JOURNEY.md)
to understand how the codebase got to where it is: what was tried, what broke, why a
thing is the way it is. After finishing work, they add to today's log so the next person
inherits that context. See [`CLAUDE.md`](../CLAUDE.md) for the full workflow.

## Convention

- **One file per active development date**, named `YYYY-MM-DD.md` (e.g. `2026-09-27.md`).
- Create today's file the first time you change code on that date; **append** to it for
  every further change that day. Do not open a file for a date with no work.
- Keep entries concrete: what changed, in which files/areas, why, and how it was
  verified. Note bugs fixed with their root cause — future-you will thank you.
- Logs are append-only history. **Don't rewrite old logs** to match later reality; if
  something a past log describes was later changed or reversed, record that in the log
  for the day it changed.

## Entry template

```markdown
# 2026-09-27

## <short title of the change>

- **What:** what changed, at a glance.
- **Why:** the motivation or the bug being fixed (root cause if it's a fix).
- **Areas:** files / modules / features touched.
- **Verification:** tests run, manual checks, quality gates.
- **Follow-ups:** anything deferred or worth watching (optional).
```

Group multiple changes under one dated file as separate `##` sections. Dates before this
system was introduced were **backfilled from git history**, so they summarize each day's
commits rather than capturing the fuller detail the go-forward convention expects.
