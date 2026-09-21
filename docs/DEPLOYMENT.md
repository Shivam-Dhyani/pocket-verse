# Deploying Pocketverse (free tiers)

Everything below runs on free plans. Total cost: ₹0/month.

| Piece             | Service            | Free tier that matters                  |
| ----------------- | ------------------ | --------------------------------------- |
| Web app (Next.js) | Vercel             | Generous static/serverless hosting      |
| API (Express)     | Render             | 750 h/month, sleeps after ~15 min idle  |
| Postgres          | Neon               | 0.5 GB storage, auto-suspends when idle |
| Redis (optional)  | Upstash            | 500K commands/month                     |
| File bytes        | User's own storage | Not our infrastructure at all           |

Architecture reminder: file bytes never rest on our servers — they stream
through the API into each user's own storage. Our footprint is metadata
(Postgres) plus in-flight staging on the API's disk.

### Why these hosts (and why Vercel over Netlify)

The web app is **Next.js 15 App Router**. Vercel builds Next.js, so every
App-Router feature (server components, streaming/`Suspense`, `instrumentation`,
the `@sentry/nextjs` plugin) is first-class with zero config, and it
auto-detects this pnpm monorepo's `apps/web` root. Netlify runs Next.js only
through an adapter that lags newer App-Router internals and needs manual
base-directory wiring — workable, but more friction for no benefit here. Render
hosts the long-lived Express API (Vercel's serverless functions are the wrong
shape for streaming multi-GB uploads through a persistent process). Neon holds
the metadata. **Recommended trio: Render (API) + Vercel (web) + Neon (DB).**

---

## For future developers: run it locally first

Before touching production, get the stack running on your machine. You need
Node ≥ 22, `pnpm` (via `corepack enable`), and a Postgres you can reach (local
install, Docker, or a throwaway Neon database).

```bash
# 1. Install every workspace's deps from the repo root
corepack enable && pnpm install

# 2. Configure env — copy the template and fill in the blanks
cp .env.example .env
#   Minimum to boot the API:
#     DATABASE_URL      your Postgres string
#     JWT_SECRET        openssl rand -base64 48
#     MASTER_KEYS       k1:$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
#     MASTER_KEY_ACTIVE k1
#     TELEGRAM_API_ID / TELEGRAM_API_HASH   from https://my.telegram.org
#   Everything else has a sane default or is optional (see the file's comments).

# 3. Create the schema in your database
pnpm --filter @pocketverse/api prisma:migrate

# 4. Run API (:4000) and web (:3000) together
pnpm dev
```

Then confirm your change is sound before you ever push — the same gates CI and
your reviewers expect:

```bash
pnpm typecheck && pnpm lint && pnpm --filter @pocketverse/api test && pnpm --filter @pocketverse/web build
```

New to the data model? Read `docs/DATABASE.md` (the living table↔endpoint map)
and `README.md` (phase-by-phase feature tour) before deploying.

---

## 0. Prerequisites

- The repo pushed to GitHub.
- MTProto app credentials from https://my.telegram.org → API development tools
  (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`). These identify the app, not any user.
- Generated secrets (run locally, keep them somewhere safe):

  ```bash
  # JWT_SECRET
  openssl rand -base64 48
  # One master key for MASTER_KEYS (value after "k1:")
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```

## 1. Neon (Postgres)

1. https://neon.tech → new project (any region close to your Render region).
2. Copy the **direct** connection string (not the pooled one — simplest for
   Prisma migrations, and free-tier traffic is well within direct limits) and
   append `&connect_timeout=15`, so it ends with
   `?sslmode=require&connect_timeout=15`. Neon suspends idle databases and
   takes a few seconds to wake; Prisma's default 5 s timeout gives up first
   (`P1001 Can't reach database server`).
3. That string is your `DATABASE_URL`. Nothing else to do — migrations run
   automatically on API deploys.

Capacity note: 0.5 GB of metadata ≈ roughly 100–200K file records. The bytes
themselves are in users' storage, so this is the only per-file cost we carry.

## 2. Upstash (Redis) — optional

The API runs its job queue in-process when `REDIS_URL` is unset, which is fine
for a single free instance. Add Upstash later if you scale to multiple
instances or want jobs to survive restarts:

1. https://upstash.com → create a Redis database (regional, same region).
2. Copy the `rediss://…` URL → `REDIS_URL`.

## 3. Render (API)

The repo contains `render.yaml`, so use a Blueprint deploy:

1. https://render.com → New → **Blueprint** → connect the GitHub repo.
2. Render reads `render.yaml` and prompts for the `sync: false` env vars:

   | Var                 | Value                                                                       |
   | ------------------- | --------------------------------------------------------------------------- |
   | `DATABASE_URL`      | Neon direct connection string                                               |
   | `JWT_SECRET`        | generated above                                                             |
   | `MASTER_KEYS`       | `k1:<base64 key generated above>`                                           |
   | `MASTER_KEY_ACTIVE` | `k1`                                                                        |
   | `CORS_ORIGIN`       | your Vercel URL (placeholder now, fix in step 5)                            |
   | `TELEGRAM_API_ID`   | from my.telegram.org                                                        |
   | `TELEGRAM_API_HASH` | from my.telegram.org                                                        |
   | `REDIS_URL`         | Upstash URL, or leave empty                                                 |
   | `RESEND_API_KEY`    | resend.com key for password-reset emails, or leave empty (links are logged) |
   | `MAIL_FROM`         | verified sender, e.g. `Pocketverse <noreply@yourdomain>`                    |

3. Deploy. First build takes a few minutes; `prisma migrate deploy` creates the
   schema, then `/health` goes green.
4. Note the service URL, e.g. `https://pocketverse-api.onrender.com`.

What's already handled in code for this environment:

- `trust proxy` is enabled in production so rate limiting sees real client IPs.
- SIGTERM triggers a graceful shutdown (deploys don't cut off in-flight parts).
- Refresh cookies are `SameSite=None; Secure` in production because web and API
  are different sites.
- A daily keep-alive sweep pings storage connections untouched for 30+ days so
  users' storage accounts never trip the platform's inactivity deletion.

## 4. Vercel (web)

1. https://vercel.com → Add New Project → import the repo.
2. **Root Directory:** `apps/web` (Vercel auto-detects Next.js and pnpm).
3. Environment variables:

   | Var                                                   | Value                                                   |
   | ----------------------------------------------------- | ------------------------------------------------------- |
   | `NEXT_PUBLIC_API_URL`                                 | the Render URL from step 3                              |
   | `NEXT_PUBLIC_UPLOAD_WARN_FILE_COUNT`                  | optional, default 500                                   |
   | `NEXT_PUBLIC_UPLOAD_MAX_FILE_COUNT`                   | optional, default 2000                                  |
   | `NEXT_PUBLIC_UPLOAD_SUGGESTED_BATCH`                  | optional, default 300                                   |
   | `NEXT_PUBLIC_GA_ID`                                   | optional — GA4 id (`G-…`)                               |
   | `NEXT_PUBLIC_SENTRY_DSN`                              | optional — Sentry browser DSN                           |
   | `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | optional — upload source maps for readable stack traces |

4. Deploy and note the URL, e.g. `https://pocketverse.vercel.app`.

## 5. Close the loop

1. Back in Render → Environment → set `CORS_ORIGIN` to the exact Vercel URL
   (scheme included, no trailing slash): `https://pocketverse.vercel.app`.
   Save — Render redeploys automatically.
2. **Keep the API awake (recommended):** free Render sleeps after ~15 min idle
   and cold-starts in ~30–60 s. Create a free https://uptimerobot.com monitor
   hitting `https://<render-url>/health` every 10 minutes. This also gives you
   uptime alerts for free.

## 6. Verify

- [ ] `https://<render-url>/health` returns `{"status":"ok"}`
- [ ] Register a new account on the Vercel URL
- [ ] Hard-refresh → still signed in (proves cross-site cookies work)
- [ ] Connect a storage account (phone → code → optional 2FA)
- [ ] Upload a file, watch it sync, see it in the storage channel
- [ ] Download it back; preview an image
- [ ] Upload a small folder — arrives nested, shown as one item
- [ ] Delete a file — disappears from the storage channel too
- [ ] Activity page lists everything you just did

## Known limitations of the free tier (go in with eyes open)

None of these are bugs — they're the shape of free hosting. Know them before
you test, so expected behavior doesn't read as breakage.

- **One CORS origin.** The API allows exactly the URL in `CORS_ORIGIN`, and
  auth cookies are credentialed. So **Vercel preview deployments** (their own
  random per-commit URLs) can't sign in — only your one production URL can.
  Test auth on the production domain, not a preview. To support previews later
  you'd widen the CORS check to a list/regex of allowed origins.
- **Render free disk is ephemeral and small.** In-flight chunks stage to
  `.staging` on disk (up to `CHUNK_SIZE_BYTES`, 1.5 GB, per chunk) before they
  ship to the user's storage, then are deleted. A single very large upload
  briefly pressures the free instance's disk; it clears chunk by chunk. This is
  the free tier's real ceiling — lower `CHUNK_SIZE_BYTES` if you hit it, or move
  to a paid instance with a persistent disk for heavy use.
- **Render free sleeps after ~15 min idle** (~30–60 s cold start) and gives
  ~750 instance-hours/month. The UptimeRobot ping in step 5 keeps it warm and
  is strongly recommended.
- **Neon free suspends when idle** and holds 0.5 GB (≈100–200K file records —
  metadata only). First request after idle wakes it; `connect_timeout=15` on
  `DATABASE_URL` covers the wake latency.
- **In-process job queue** (no `REDIS_URL`): jobs don't survive a restart or
  deploy. Fine for one instance; add Upstash (step 2) if you scale out or want
  jobs durable across restarts.

## Troubleshooting

| Symptom                               | Cause / fix                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| First request takes ~a minute         | Free Render cold start. UptimeRobot (step 5) makes this rare.                                                             |
| Signed out after refresh              | `CORS_ORIGIN` doesn't exactly match the Vercel URL, or you're testing over plain http (production cookies require https). |
| `DATABASE_NOT_MIGRATED` errors        | `prisma migrate deploy` didn't run — check the deploy logs; is `DATABASE_URL` right?                                      |
| Uploads pause mid-file after a deploy | Expected: staging disk is wiped on deploys. The client resumes from the server's part cursor automatically.               |
| `FLOOD_WAIT` in logs                  | The storage platform is throttling. The queue backs off and retries by itself; nothing to do.                             |
| Neon "too many connections"           | Use the direct URL with default Prisma pool, or switch `DATABASE_URL` to Neon's pooled string.                            |
| `P1001 Can't reach database server`   | Neon's compute is waking from idle and Prisma timed out. Append `connect_timeout=15` to `DATABASE_URL` and retry.         |

## Operations

- **Key rotation:** add `k2:<new base64>` to `MASTER_KEYS` (comma-separated),
  set `MASTER_KEY_ACTIVE=k2`, redeploy. Old data still decrypts via k1; new
  data wraps with k2. Remove k1 only after re-wrapping stored keys.
- **Migrations:** `pnpm --filter @pocketverse/api prisma:migrate` locally
  creates a migration; pushing to the deploy branch applies it on Render via
  `migrate deploy`.
- **Logs:** Render → service → Logs. Sessions, tokens, and keys are redacted
  by the logger; audit events live in the `AuditEvent` table.
- **Backups:** Neon free keeps short point-in-time history. The genuinely
  irreplaceable data is `StorageConnection` rows (encrypted sessions) and file
  metadata — consider an occasional `pg_dump`.
