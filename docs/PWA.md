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
- **Cache-first** for the precached set (`PRECACHE_URLS`). This branch is not
  optional: without it the install cache was written but never _read_, so
  anything `offline.html` referenced went to the network and rendered broken
  while offline. `offline.html` now also inlines its own artwork, so it holds up
  even with an empty cache.
- **Network-first** for page navigations, falling back to `offline.html` only
  when the network is unreachable. Drive HTML is always fetched fresh.

Precaching is done one URL at a time rather than with `cache.addAll()`, which is
all-or-nothing — a single renamed icon would otherwise fail the whole install
and leave the app with no worker and no offline page at all.

The offline page is only reached by a _navigation_. Inside the running app
(especially an installed one, where you rarely navigate) losing the network used
to surface as a generic "can't reach the server" error, so `OfflineBanner`
watches `online`/`offline` and says so plainly. `offline.html` reloads itself
when connectivity returns, and follows the app's stored light/dark theme.

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
(`name`, `background_color`, and the icon). **You cannot supply a custom splash
image or layout on Android** — there is no API for it. The OS composes it, and
the only levers are the three manifest fields above. `AppSplash` below is a
_matching_ screen, not the OS one. On Android 12+ the system also adds its own
icon animation on top of Chrome's, which is why a launch can look like two
splashes in a row.

Two things make the OS splash go wrong, both worth remembering:

1. **Icons must be raster.** Android builds an APK ("WebAPK") for an installed
   PWA and draws the splash from the manifest icons; it does not rasterize SVG.
   An `icon.svg` entry with `sizes: "any"` can win Chrome's "best match" pick
   and then fall back to a generic mark. The manifest therefore lists PNGs only,
   at several densities, plus maskable 192 and 512 (Android 12+ animates the
   maskable one). The SVG remains the source art and the tab favicon.
2. **An installed app keeps its old splash until the WebAPK updates.** The
   icon, name and colours are baked in at install time. Chrome re-checks the
   manifest only periodically (roughly daily, and it can take days to apply), so
   deploying a manifest change does **not** update an already-installed app the
   way a code change does. To see it immediately, uninstall the app and install
   it again from Settings.

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

## System bars (status bar + navigation bar)

**Read this before touching `viewportFit`, the `html`/`body` backgrounds, or
`theme-color`.** It was got wrong twice before the model below was established.

### How Android 15+ actually works

Android 15 makes every app edge-to-edge. The status and navigation bars are
**transparent**, and the OS ignores requests to colour them. Whatever is drawn
_behind_ them is what the user sees. For an installed PWA that is one of two
things:

1. **Our page**, if Chrome extends the installed app under the bars. That needs
   `viewport-fit=cover` _and_ a Chrome build that honours it for installed apps.
2. **The app's window background** otherwise — which Chrome sets from the
   manifest's `background_color`. It is fixed at install time and cannot follow
   a runtime theme toggle.

Separately, `theme-color` still drives the **icon contrast** (light or dark
clock/battery icons) — even where it no longer paints the bar background.

The telltale symptom of case 2 is exactly what was reported: in light mode the
clock turns dark (Chrome read the light `theme-color`) but the band behind it
stays dark (it's the fixed window background). Dark icons on a dark band.

### What the app does

| Layer                                     | Where          | Why                                                                                                                                                                  |
| ----------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewport-fit=cover`                      | `layout.tsx`   | Lets the page draw under the bars — the only way the page can colour them.                                                                                           |
| `body` padding = `env(safe-area-inset-*)` | `globals.css`  | Keeps content clear of the bars. Insets are `0` when the page isn't under them, so nothing moves on devices that don't support it.                                   |
| `body::before` strip                      | `globals.css`  | Paints the area behind the status bar so content scrolling up doesn't pass behind the clock. Uses the _same_ viewport-fixed background as `html`, so it is seamless. |
| Page background on `html`, not `body`     | `globals.css`  | The root's background covers the whole canvas whatever the content height. On `body` it stopped where the content did, leaving a flat band on short pages.           |
| Adaptive `theme-color`                    | `lib/theme.ts` | See below.                                                                                                                                                           |
| One colour source                         | `lib/theme.ts` | Manifest, pre-paint script and runtime all read `THEME_COLORS` / `MANIFEST_BACKGROUND`. Mismatched values between these produce a visible seam.                      |

### Adaptive `theme-color` (`detectSystemBars()`)

`theme-color` normally follows the app theme. The single exception: when the app
is installed, the page does **not** extend under the status bar (safe-area inset
is `0`), and the device is on **Android 15+**. In that case the band is stuck on
`MANIFEST_BACKGROUND`, so `theme-color` is pinned to it — otherwise light mode
puts dark icons on a dark band. The result is persisted (`pv-bars-fixed`) so the
pre-paint script gets it right on the next launch with no flicker, and it is
re-checked on every launch and on resize, so the pin lifts automatically once a
Chrome update starts drawing the app under the bars.

| Situation                                           | Bar background             | `theme-color` |
| --------------------------------------------------- | -------------------------- | ------------- |
| Browser tab                                         | browser's own UI           | follows theme |
| Installed, Android ≤ 14                             | painted from `theme-color` | follows theme |
| Installed, Android 15+, page under the bars         | our page                   | follows theme |
| Installed, Android 15+, page **not** under the bars | fixed manifest colour      | pinned to it  |

The Android version comes from `navigator.userAgentData` (the UA string is frozen
at "Android 10" by Chrome's UA reduction). If it can't be determined, the app
assumes the bar follows `theme-color` — the historical behaviour — so detection
can only ever improve on the default.

### What was confirmed on a real device

Tested on a Samsung phone (Android 15, 3-button navigation):

- The **navigation bar follows the phone's light/dark setting**, whatever
  theme the app is in.
- The **status bar band is the `theme_color` baked into the installed app** at
  install time. Chromium paints an installed app's top bar from that baked
  value only; runtime `<meta name="theme-color">` does not reach it, and the old
  `color_scheme_dark` manifest member is no longer parsed. It changes only when
  Chrome rebuilds the app (daily check, only while charging on unmetered
  networks) or on reinstall.

So no web code can make the installed app's system bars follow an in-app
toggle. That's why the theme preference defaults to **Match device**
(`ThemePreference = 'system'`, stored under `pv-theme-pref`): the app follows
the phone, so app and navigation bar agree. Picking Light or Dark by hand still
works for the app itself; the phone's bars keep following the phone.

`pv-theme-pref` replaced the old `pv-theme` key on purpose: the old two-state
toggle wrote `dark` on every mount, so that value never meant a real choice.

### Limits worth knowing

- **3-button navigation:** Chrome only extends pages under the _gesture_ bar. With
  the 3-button bar, no web page can colour it in an installed app; it shows the
  window background. Gesture navigation doesn't have this limit.
- A light status bar in light mode requires Chrome to draw the installed app
  under the status bar. Where it doesn't, the best any page can do is legible
  icons on the fixed band — which is what the pin guarantees.

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
