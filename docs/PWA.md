# Pocketverse as a PWA

This document records **exactly what was added to turn the Pocketverse web app
into an installable Progressive Web App (PWA)**, and the principles behind those
choices. If you're picking up this codebase, read this before touching anything
under `apps/web/public/` or the service worker — a few of the decisions here are
deliberate and easy to undo by accident.

## What "PWA" means here (and what it deliberately does not)

A PWA is a normal web app plus three things a browser looks for: a **web app
manifest**, a **service worker**, and **icons**. Together they let the browser
_offer_ to install the site as a standalone app — its own icon on the home
screen or desktop, launched full-screen without browser chrome.

Two design rules shape everything below:

1. **Installation is opt-in, never a popup.** The one and only place a user is
   invited to install is a card in **Settings** (the `/security` page). We
   actively suppress the browser's automatic install banner. A user who never
   opens that card is never nudged.
2. **We cache almost nothing.** Pocketverse streams multi-GB files through the
   API into each user's _own_ storage, and every drive view is per-user and
   auth-gated. Caching that data would be wrong — it could serve one person's
   files to another, or show a stale drive. So the service worker is minimal:
   it exists to make the app installable and to show a friendly offline page,
   not to make the app work offline. **Pocketverse is online-first by nature —
   your files aren't on the device, so there's nothing meaningful to use
   offline.**

## Files added

| File                                                                                            | Purpose                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/manifest.ts`                                                                  | The web app manifest (Next serves it at `/manifest.webmanifest` and auto-injects `<link rel="manifest">`). Declares name, icons, colors, `display: standalone`, and `start_url: /drive`.           |
| `apps/web/public/sw.js`                                                                         | The service worker. Precaches only the offline page + icons; runtime-caches only Next's immutable `/_next/static/` assets; never touches `/api/*`, file bytes, range requests, or navigation HTML. |
| `apps/web/public/offline.html`                                                                  | Branded fallback shown only when a navigation happens with no network.                                                                                                                             |
| `apps/web/public/icon.svg`                                                                      | **Source of truth** for all app icons — the orbit mark on a dark tile, kept inside the maskable safe zone.                                                                                         |
| `apps/web/public/favicon.svg`                                                                   | Browser-tab favicon (legible at 16px).                                                                                                                                                             |
| `apps/web/public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | Rasterized from `icon.svg`. Committed so production/CI never need to rasterize.                                                                                                                    |
| `apps/web/scripts/gen-icons.mjs`                                                                | Regenerates the PNGs from `icon.svg` using `sharp` (a devDependency). Run with `pnpm --filter @pocketverse/web icons`.                                                                             |
| `apps/web/src/stores/pwa.ts`                                                                    | Zustand store holding the captured install event + installed state, plus `isStandalone()` / `isIos()` helpers.                                                                                     |
| `apps/web/src/components/pwa-register.tsx`                                                      | Mounted once at app root. Registers the service worker and intercepts `beforeinstallprompt` to stop the automatic banner. Renders nothing.                                                         |
| `apps/web/src/components/install-app.tsx`                                                       | The opt-in "Install the app" card rendered in Settings.                                                                                                                                            |

## Files changed

| File                                     | Change                                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/layout.tsx`            | Added PWA metadata: `manifest`, `icons` (favicon + apple-touch-icon), `appleWebApp` (iOS standalone + status bar), and a `viewport` export with `themeColor` and `viewportFit: 'cover'`.    |
| `apps/web/src/components/providers.tsx`  | Mounts `<PwaRegister />` at app root.                                                                                                                                                       |
| `apps/web/src/app/security/page.tsx`     | Renders `<InstallApp />` in the Settings section.                                                                                                                                           |
| `apps/web/src/lib/analytics.ts`          | Added `app_installed` to the analytics event allow-list (fires only on a successful install; no identifying data).                                                                          |
| `apps/web/next.config.ts`                | `must-revalidate` cache headers for `/sw.js` and `/manifest.webmanifest`, so a cached worker can't stall updates; plus the `/api/auth/*` rewrite that keeps the refresh cookie first-party. |
| `apps/web/src/components/app-splash.tsx` | The launch screen painted at first render, mirroring the manifest splash.                                                                                                                   |
| `apps/web/src/lib/api.ts`                | Auth requests go to our own origin (proxied); file traffic still hits the API directly.                                                                                                     |
| `apps/web/src/app/drive/page.tsx`        | Renders `<AppSplash/>` as the Suspense fallback and while redirecting to sign-in.                                                                                                           |
| `apps/web/package.json`                  | Added the `icons` script and `sharp` devDependency.                                                                                                                                         |
| `apps/web/src/app/globals.css`           | Added `.pv-install-done` / `.pv-install-steps` styles for the install card.                                                                                                                 |

## How the opt-in install flow works

```
        browser decides the app is installable
                        │
                        ▼
   window 'beforeinstallprompt' fires  ──►  PwaRegister:
                        │                    event.preventDefault()  (kills the auto-banner)
                        │                    stash event in usePwaStore
                        ▼
   user opens Settings → "Install the app" card (InstallApp)
                        │
              clicks "Install Pocketverse"
                        ▼
          deferredPrompt.prompt()  ──►  native install dialog
                        │
             accepted ─┴─ dismissed
                │             └─ show "install anytime" note
        track('app_installed'), mark installed
```

Platform differences the `InstallApp` card handles:

- **Chromium (Chrome/Edge/Android/desktop):** fires `beforeinstallprompt`, so
  the card shows a real **Install Pocketverse** button.
- **iOS/iPadOS Safari:** no install event exists — the card shows the
  **Share → Add to Home Screen** steps instead (detected via `isIos()`).
- **Already installed / other browsers:** the card shows a confirmation, or
  brief "use your browser's install menu" guidance, so the section is never a
  dead end.

## The caching policy, precisely

The service worker's `fetch` handler:

- **Ignores** anything that isn't a same-origin `GET`.
- **Ignores** `/api/*` and any request carrying a `Range` header (file
  downloads) — these always go straight to the network, uncached.
- **Cache-first** only for `/_next/static/*` — these filenames are
  content-hashed and immutable, so caching them is safe and makes repeat loads
  fast.
- **Network-first** for page navigations, falling back to `offline.html` only
  when the network is unreachable. Drive HTML is always fetched fresh.

Bump `CACHE_VERSION` in `sw.js` to retire old caches on the next activation.

## Do installed apps get updates after a redeploy? (Yes)

An installed PWA is not a frozen copy of the site — it loads the same URL from
the network each launch. A redeploy reaches installed users **on their next
launch** (or next foreground), with no reinstall and nothing for them to do.

Why that holds here, concretely:

1. **HTML is never cached.** Navigations are network-first, so launching the app
   fetches the current page from the server.
2. **JS/CSS are content-hashed.** Fresh HTML references new
   `/_next/static/<hash>` filenames, which have never been cached, so they're
   fetched. Old files stay cached but are simply no longer referenced.
3. **The worker itself updates.** The browser re-fetches `/sw.js` on navigation
   and whenever `registration.update()` runs — `pwa-register.tsx` calls it every
   time the app returns to the foreground, so a long-lived installed app doesn't
   wait for the browser's own (up to 24h) check. `sw.js` calls `skipWaiting()`
   on install and `clients.claim()` on activate, so a new worker takes over
   immediately rather than idling until every tab closes.
4. **`/sw.js` is served `must-revalidate`** (see `next.config.ts`). This matters:
   if a CDN serves a stale worker, updates stall — it's the most common reason a
   PWA "won't update".

Deliberately **not** done: we never force-reload a page that's already open. An
upload only survives while the tab lives, so yanking the page out from under a
running upload would be worse than showing slightly old UI until next launch.

One caveat: things in `PRECACHE_URLS` (`offline.html`, icons) are written once
per worker version. If you edit those, **bump `CACHE_VERSION`** or existing
installs keep the old copies.

## The launch screen (splash)

An installed app gets a splash screen from the OS, built from the manifest
(`name`, `background_color`, and the icon). You cannot turn it off or restyle
it — and on Android 12+ the system adds its own icon animation on top of
Chrome's, which is why a launch can look like two splashes in a row.

What you _can_ control is what the app paints when that splash hands off. If the
first frame looks different — a spinner in a corner, a logo in a new position,
or a blank frame — it reads as a second splash appearing. So `AppSplash`
(`components/app-splash.tsx`) deliberately mirrors the manifest splash:

- the same background as `background_color` (`#070b16`),
- the same icon artwork, inlined as SVG (not `<img src="/icon.svg">`) so it
  costs no request and cannot flash in late,
- the app name below it, matching what the OS splash prints,
- and **no animation at all** — any entrance transition re-introduces exactly
  the "second screen" effect we're removing.

It is server-rendered (no `'use client'`), so it is in the prerendered HTML for
`/drive` — the manifest's `start_url`, and therefore the first paint the OS
splash hands off to. It is also used while the drive redirects to sign-in, so
that path shows the launch screen instead of an empty frame.

If you change `background_color` in the manifest, change `.pv-splash`'s
background to match, or the seam becomes visible again.

## Staying signed in (why auth is proxied)

The web app and the API are different sites (`*.vercel.app` →
`*.onrender.com`), which made the httpOnly refresh cookie a **third-party
cookie**. Safari blocks those outright and Chrome increasingly does too, so the
cookie was dropped and the session ended as soon as the in-memory access token
went away — i.e. every time the tab or the app was closed.

Fix: `next.config.ts` rewrites `/api/auth/:path*` to the API, and
`lib/api.ts` requests those paths from the app's own origin. The cookie is then
set by our origin and is simply first-party. Uploads and downloads are
deliberately **not** proxied — they stream multi-GB bodies straight to the API,
which a serverless proxy could not carry.

## Regenerating the icons

Edit `apps/web/public/icon.svg`, then:

```bash
pnpm --filter @pocketverse/web icons
```

This rewrites the four committed PNGs. Keep the mark inside the central ~80% of
the canvas so the **maskable** icon isn't clipped when Android crops it to its
own shape. `sharp` is a devDependency used only by this script — it is not in
the runtime bundle, and CI/production never run it.

## Testing the PWA locally

Service workers need a secure context, which `localhost` counts as. **They only
register in a production build**, so `pnpm dev` won't show install behavior —
use:

```bash
pnpm --filter @pocketverse/web build && pnpm --filter @pocketverse/web start
```

Then, in Chrome DevTools:

- **Application → Manifest** — should list the icons with no errors and show
  "Installable".
- **Application → Service Workers** — `sw.js` should be activated.
- The address bar shows an **install icon**; installing should _not_ have popped
  up on its own — only the Settings card and the browser's own menu offer it.
- **Lighthouse → PWA** category is a quick overall check.

For iOS you need a real device (or simulator) on `https://` — Safari only offers
Add to Home Screen over HTTPS, which the production deployment provides.

## Known limitations / future work

- **No true offline mode.** By design (files live in the user's storage, not on
  the device). If offline browsing of _metadata_ (folder listings) is ever
  wanted, it would mean caching per-user API responses in IndexedDB behind an
  explicit opt-in, with careful cache-partitioning and sign-out purging — a
  deliberate feature, not a config tweak.
- **No push notifications.** The service worker has no `push` handler. Adding
  one would need a backend Web Push subscription store and VAPID keys.
- **iOS install is manual.** Apple gives no install prompt API, so the
  Share-sheet instructions are the best achievable there.
