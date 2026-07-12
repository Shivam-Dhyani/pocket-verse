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
   Prisma migrations, and free-tier traffic is well within direct limits).
   It looks like `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`.
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

   | Var                 | Value                                            |
   | ------------------- | ------------------------------------------------ |
   | `DATABASE_URL`      | Neon direct connection string                    |
   | `JWT_SECRET`        | generated above                                  |
   | `MASTER_KEYS`       | `k1:<base64 key generated above>`                |
   | `MASTER_KEY_ACTIVE` | `k1`                                             |
   | `CORS_ORIGIN`       | your Vercel URL (placeholder now, fix in step 5) |
   | `TELEGRAM_API_ID`   | from my.telegram.org                             |
   | `TELEGRAM_API_HASH` | from my.telegram.org                             |
   | `REDIS_URL`         | Upstash URL, or leave empty                      |

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

   | Var                                  | Value                      |
   | ------------------------------------ | -------------------------- |
   | `NEXT_PUBLIC_API_URL`                | the Render URL from step 3 |
   | `NEXT_PUBLIC_UPLOAD_WARN_FILE_COUNT` | optional, default 500      |
   | `NEXT_PUBLIC_UPLOAD_MAX_FILE_COUNT`  | optional, default 2000     |
   | `NEXT_PUBLIC_UPLOAD_SUGGESTED_BATCH` | optional, default 300      |

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

## Troubleshooting

| Symptom                               | Cause / fix                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| First request takes ~a minute         | Free Render cold start. UptimeRobot (step 5) makes this rare.                                                             |
| Signed out after refresh              | `CORS_ORIGIN` doesn't exactly match the Vercel URL, or you're testing over plain http (production cookies require https). |
| `DATABASE_NOT_MIGRATED` errors        | `prisma migrate deploy` didn't run — check the deploy logs; is `DATABASE_URL` right?                                      |
| Uploads pause mid-file after a deploy | Expected: staging disk is wiped on deploys. The client resumes from the server's part cursor automatically.               |
| `FLOOD_WAIT` in logs                  | The storage platform is throttling. The queue backs off and retries by itself; nothing to do.                             |
| Neon "too many connections"           | Use the direct URL with default Prisma pool, or switch `DATABASE_URL` to Neon's pooled string.                            |

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
