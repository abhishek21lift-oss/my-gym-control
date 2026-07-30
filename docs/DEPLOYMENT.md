# Deployment

Three services, three platforms:

| What | Where | Config |
|---|---|---|
| `apps/api` (NestJS) + Postgres + Redis | Render | [`render.yaml`](../render.yaml) |
| `apps/app` (Next.js) | Vercel | [`apps/app/vercel.json`](../apps/app/vercel.json) |
| Tests, migrations | GitHub Actions | [`.github/workflows/`](../.github/workflows) |

**Verification happens in CI**, not on a developer machine. Every push runs the
cross-tenant isolation and RLS suites against a real Postgres 18 service container. That
is deliberate: those two suites are the load-bearing security tests of the platform, and
they must pass on infrastructure nobody can accidentally misconfigure locally.

---

## Order of operations

The first deploy has a chicken-and-egg problem worth doing in the right order, because
the API's health check queries the database and will fail against an empty schema.

### 1. Push to GitHub

```bash
git remote add origin https://github.com/<you>/my-gym-control.git
```

```bash
git push -u origin main
```

CI runs on push. **Confirm it is green before deploying anything** — if the isolation
suite fails, nothing else matters.

### 2. Create the Render services

Render Dashboard → **New** → **Blueprint** → select this repository. It reads
`render.yaml` and creates:

- `mgc-postgres` — Postgres 17, Singapore, private (no public IP)
- `mgc-cache` — Redis with `maxmemory-policy noeviction`
- `mgc-api` — the API, health-checked at `/api/v1/health/ready`

The first deploy will build successfully and then **fail its health check**, because the
schema does not exist yet. That is expected. Continue to step 3.

### 3. Apply migrations

Copy the database's **external** connection string from the Render dashboard, then in
GitHub: **Settings → Environments → New environment** named `production`, and add a
secret `DIRECT_URL` set to that connection string.

Then run **Actions → Migrate database → Run workflow**, choosing `production` and typing
`production` to confirm.

Migrations are a separate manual step on purpose. Running them from the API's start
command would execute schema changes on every boot and every autoscale event, which is
how two instances end up racing the same migration and leaving a half-applied schema.
Render's `preDeployCommand` is the built-in answer but requires a paid instance.

### 4. Redeploy the API

Render → `mgc-api` → **Manual Deploy**. The health check now passes:

```bash
curl https://mgc-api.onrender.com/api/v1/health/ready
```

```json
{ "status": "ok", "checks": { "database": { "status": "up", "latencyMs": 12 } } }
```

### 5. Deploy the app to Vercel

Vercel → **Add New Project** → import the repository, then:

- **Root Directory**: `apps/app`
- **Include source files outside of the Root Directory**: **on** (the app imports
  `@mgc/ui` and `@mgc/contracts` from the workspace, so the build needs the repo root)
- **Framework**: Next.js (auto-detected)

Environment variables:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://mgc-api.onrender.com` |
| `NEXT_PUBLIC_APP_URL` | your Vercel URL |
| `NEXT_PUBLIC_SITE_URL` | your Vercel URL (until the marketing site exists) |

### 6. Close the CORS loop

Once Vercel assigns the real domain, update these in Render and redeploy:

- `CORS_ORIGINS` → the exact app origin
- `WEBAUTHN_RP_ID` → the bare domain, no scheme, no port
- `WEBAUTHN_ORIGIN` → the full `https://` origin

The env schema **refuses to boot** in production on a wildcard or localhost CORS origin,
or on a non-HTTPS WebAuthn origin. That is intentional: a wildcard origin on a
cookie-authenticated API is the single most common way one gets compromised.

---

## Free-tier caveats

Worth knowing before you conclude something is broken:

- **Render free web services sleep after ~15 minutes idle.** The first request after that
  takes 30–60 seconds. A health check timing out on a cold start is not a bug.
- **Render free Postgres expires after 30 days.** Fine for validation; a paid instance is
  required before real data. Export before it lapses.
- **Free plans have no `preDeployCommand`**, which is why migrations are a separate step.

---

## Swapping Render Postgres for Supabase

Supabase is the intended production database (it also provides Auth in Phase 1). To move:

1. Set `DATABASE_URL` to the **pooled** connection (port `6543`, `?pgbouncer=true`).
2. Set `DIRECT_URL` to the **direct** connection (port `5432`).

The split matters. Prisma Migrate takes session-level advisory locks and runs DDL across
statements; a transaction pooler breaks both. The env schema requires `DIRECT_URL` in
production for exactly this reason.

Supabase runs Postgres 17, which has no native `uuidv7()`. The first migration installs a
spec-compliant pl/pgsql equivalent when the server lacks one, so the schema applies
unchanged — see
[`20260727200000_uuidv7_compat`](../packages/db/prisma/migrations/20260727200000_uuidv7_compat/migration.sql).

---

## What is not deployed yet

- `apps/web` (marketing site) — Phase 7, per the roadmap's own sequencing.
- `apps/worker` (BullMQ consumers) — Phase 5, when the first queued job exists. `mgc-cache`
  is provisioned now because the env schema requires `REDIS_URL`, and rate limiting will
  move onto it before the worker lands.
- Cloudflare R2 — `STORAGE_*` are marked `sync: false` in the blueprint, so Render prompts
  for them rather than deploying without them.
