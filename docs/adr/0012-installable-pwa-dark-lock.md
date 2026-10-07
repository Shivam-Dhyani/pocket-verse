# ADR-0012: Installable PWA with an opt-in install, a dark-mode lock, and an update prompt

**Status:** Accepted · September 2026 · post-launch (mobile)

## Context

Pocketverse is used heavily on phones, so it should feel like an installed app —
but platform behaviour imposes hard limits that drive several non-obvious
decisions, especially on Android edge-to-edge and iOS standalone.

## Decision

- **Installable PWA, opt-in only.** A service worker (install + a friendly
  offline page; it never caches `/api`, file bytes, or navigations' HTML) makes
  the app installable, but the automatic browser install banner is suppressed —
  installing is offered **only** from Settings.
- **Dark-mode lock (`FORCED_THEME`).** The installed Android app's status bar is
  painted from the manifest `theme_color` baked in at install time and cannot
  follow the in-app theme, so a light theme would always show a dark band above a
  light page. The app is locked to dark; all light-mode styling is kept in the
  code behind the flag for a future revisit.
- **The `theme-color` tag is owned by a pre-paint script, never React** — removing
  a React-rendered tag crashed client-side navigations; the one tag is created
  and updated in place.
- **A build-id update prompt.** iOS standalone apps resume from memory without
  reloading and the service worker can't detect a deploy (its bytes don't
  change), so the app compares a baked `NEXT_PUBLIC_BUILD_ID` against a
  `no-store` `/version.json` and offers a non-forced reload (never mid-upload).

## Consequences

- No surprise install pop-ups; install is a deliberate user choice.
- Consistent dark chrome on installed Android; theme toggle hidden while locked.
- Deploys actually reach long-lived installed apps, iOS included.
- iOS launch images are generated per device size; details live in `docs/PWA.md`.
