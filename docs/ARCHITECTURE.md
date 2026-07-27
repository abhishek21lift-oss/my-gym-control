# MY GYM CONTROL — Architecture

Every decision below is stated with its rationale and the alternative that was rejected.
Nothing here is aspirational: if a decision is not yet implemented, the roadmap says which
phase implements it.

---

## 0. Starting position

The repository was empty at project start (git initialised 2026-07-28). There is no legacy
code, no migration burden, and no existing schema to work around. Consequently there are no
"existing architectural issues" to report — the risk in this project is not inherited debt,
it is the debt we are about to create. Sections 1–11 exist to prevent it.

The five failure modes that kill projects of this shape, and the decision that defends
against each:

| Failure mode | Defence | Section |
|---|---|---|
| Cross-tenant data leak (one gym sees another's members) | Two independent enforcement layers | §4 |
| Six portals drift into six design systems | One app shell, one UI package | §2, §9 |
| `organizationId` forgotten in one query, forever | Enforced in the data layer, not by discipline | §4 |
| LLM given raw SQL access to the whole database | Typed, tenant-scoped tool layer | §7 |
| Body photos / health data handled like ordinary rows | Classified as sensitive; separate handling | §10 |

---

## 1. Repository shape — Turborepo + pnpm workspaces

```
my-gym-control/
├─ apps/
│  ├─ app/            Next.js 16 — all authenticated portals (owner/trainer/member/reception)
│  ├─ web/            Next.js 16 — public marketing site + AI receptionist chat
│  ├─ api/            NestJS — modular monolith HTTP API
│  └─ worker/         NestJS standalone — BullMQ consumers (AI, reports, notifications)
├─ packages/
│  ├─ ui/             Design system: tokens, shadcn primitives, motion, charts
│  ├─ db/             Prisma schema, migrations, client extensions, seed
│  ├─ contracts/      Zod schemas + inferred TS types shared by api and apps
│  ├─ auth/           Session, JWT verification, CASL ability definitions
│  ├─ ai/             Provider-agnostic LLM gateway + tool definitions
│  └─ config/         eslint, tsconfig, tailwind preset shared
└─ docs/
```

**Why Turborepo + pnpm.** Six surfaces sharing types, validation and design tokens is the
textbook monorepo case. pnpm's strict, non-hoisted `node_modules` prevents phantom
dependencies (a package importing something it never declared) — which is exactly how
monorepos rot. Turbo's content-addressed task cache makes CI proportional to what changed
rather than to repo size.

**Rejected: Nx.** More powerful, considerably more opinionated, and its generators produce
code we would immediately rewrite. Turbo is a task runner and nothing more, which is the
correct amount of framework for a build tool.

**Rejected: polyrepo.** Shared Zod contracts between NestJS and Next are the single highest-value
thing in this codebase. Splitting repos means versioning and publishing them, which means they
drift, which means runtime type errors at the API boundary.

---

## 2. Portal topology — 2 deployments, not 6

The brief lists six apps. Built literally, that is six Next.js projects, six auth
integrations, six middleware stacks, six layout shells, six deploy pipelines — and six
copies of every fix. It directly contradicts the brief's own "no duplicated code" rule.

**Decision:**

- **`apps/app`** — one Next.js 16 application containing all four authenticated portals as
  route groups: `(owner)`, `(trainer)`, `(member)`, `(reception)`. They share the app shell,
  auth, data layer, and design system. What differs between them — navigation, dashboard
  composition, permissions — is genuinely different and lives in each route group. This app
  is the installable PWA; on a phone, a member installing it *is* the Member App.
- **`apps/web`** — the public marketing site. Separate because it has an entirely different
  profile: fully static/ISR, indexed by search engines, a much stricter and simpler CSP, no
  authenticated bundle, and it must stay fast on a cold 3G visit. Bundling it with the app
  would drag the dashboard's JavaScript into a landing page.

**Consequence:** a role change is one guard, not six codebases. Adding a "Regional Manager"
role later costs one route group, not one repo.

**This is a deviation from the literal brief and is called out as such.** If separate
deployments per portal are a hard requirement (e.g. white-label per-portal domains), the
same route groups can be split into separate Next apps later without touching any
backend, contract, or UI-package code — the seam is preserved deliberately.

---

## 3. Backend — NestJS modular monolith

One deployable, hard module boundaries. Each domain module owns its Prisma models, exposes
a service interface, and may not reach into another module's repository — only its service.

```
apps/api/src/modules/
  auth/  users/  organizations/  branches/  members/  memberships/
  payments/  attendance/  workouts/  nutrition/  progress/  ai/
  reports/  notifications/  crm/  staff/  roles/  inventory/
  analytics/  media/  settings/  audit/
```

**Why a monolith.** Microservices buy independent scaling and independent deploys, and cost
distributed transactions, network failure modes, and eventual consistency. At this stage a
gym OS has none of the problems microservices solve and all of the problems they cause. The
module boundaries are real, so extraction later is mechanical — but we do not pay for it now.

**Repository pattern over Prisma.** Services depend on repository interfaces, not on
`PrismaClient`. This is not ceremony: it is what makes the tenancy extension (§4) and the
service unit tests possible without a database.

**Why NestJS specifically.** Its DI container and module system are the only mainstream Node
option that makes the above enforceable rather than conventional.

---

## 4. Multi-tenancy — the load-bearing decision

Every business table carries `organizationId`, `branchId` (nullable — some records are
org-wide), `createdBy`, `updatedBy`, `deletedAt`.

Enforcement is in **two independent layers**, because one is not enough:

**Layer 1 — Prisma Client Extension + AsyncLocalStorage.**
A NestJS middleware puts the authenticated tenant context into an `AsyncLocalStorage` store.
A Prisma client extension intercepts every query and:

- injects `organizationId` into every `where` clause on tenant-scoped models,
- injects `organizationId`, `createdBy` on create; `updatedBy` on update,
- rewrites `delete` into `update { deletedAt }`,
- adds `deletedAt: null` to every read,
- writes an `AuditLog` row for every mutation.

The point is that a developer **cannot** forget the tenant filter, because they never write
it. A query missing `organizationId` is not a bug that ships — it is impossible to express.

**Layer 2 — Postgres Row Level Security (Supabase).**
RLS policies on every tenant table keyed to the JWT's `org_id` claim. This layer exists
because the Next.js apps also talk to Supabase directly for auth, storage and realtime —
paths that never pass through the Prisma extension. It is also the backstop if layer 1 is
ever bypassed by a raw query.

**Rejected: schema-per-tenant.** Clean isolation, but cross-tenant analytics become
impossible, migrations multiply by tenant count, and connection pooling degrades badly. A
gym chain with 40 branches would need 40 schema migrations per release.

**Rejected: database-per-tenant.** Correct for enterprise/regulated single-tenant SaaS,
absurd for per-gym pricing.

**Audit history.** Append-only `AuditLog` (`actor`, `action`, `entity`, `entityId`, `before`,
`after` as JSONB, `ip`, `userAgent`, `at`). Written by the extension, never by hand, so it
cannot be selectively omitted.

---

## 5. Authentication

- **Supabase Auth as identity provider.** Email/OTP, Google OAuth. It issues the JWT.
- **NestJS verifies via JWKS**, then resolves the Supabase user to an internal `User` with
  org membership and role claims. Supabase owns *identity*; we own *authorisation*.
- **Passkeys / WebAuthn.** Note that "Face ID" and "Fingerprint" in the brief are not three
  separate features — they are one: WebAuthn platform authenticators. Face ID *is* the
  passkey UX on iOS. Implemented once with SimpleWebAuthn, credentials stored on our side so
  passkeys survive an auth-provider change.
- **Authorisation: CASL.** One ability definition in `packages/auth`, consumed by both the
  NestJS guard and the React UI. The same rule that blocks the API call also hides the
  button — no drift between "what the UI shows" and "what the server allows".
- **Sessions.** Device registry, session history, revocation, IP allow-listing per
  organisation. Refresh tokens rotated, httpOnly + `Secure` + `SameSite=Lax` cookies.

---

## 6. Frontend data flow

- **Server Components by default.** Client components only where interaction requires them.
- **TanStack Query** for client-side mutation, optimistic updates and cache invalidation;
  its keys mirror the API's resource shape.
- **Zod contracts** in `packages/contracts` are the single source of truth: NestJS validates
  requests with them, React Hook Form validates the same shapes client-side, and TypeScript
  types are inferred from them. One definition, three consumers, zero drift.
- **TanStack Table + React Virtual** for every list over ~100 rows. A gym with 4,000 members
  is a normal gym; a non-virtualised member table is unusable at that size.

---

## 7. AI architecture

**Provider-agnostic gateway (`packages/ai`).** A `LlmProvider` interface with Anthropic,
OpenAI and Gemini adapters. Task-based routing rather than one hardcoded model, so provider
outages degrade instead of breaking, and cost can be tuned per task.

**The Business Copilot does not get SQL access.** The brief says the AI should "understand
the complete database". The naive reading — give the model a schema and let it emit SQL — is
the single most dangerous thing we could build. It is prompt-injectable, cross-tenant
leakable, and unbounded in cost.

**Instead:** a tool-calling layer of typed, tenant-scoped analytics functions —
`getRevenue(range, branchId)`, `getChurnRisk()`, `getTrainerPerformance(period)`,
`getUnpaidInvoices()`, `forecastRevenue(months)` and so on. Each is a normal, tested,
permission-checked service method that already goes through the tenancy extension. The model
chooses *which* to call and explains the results; it never composes a query. Every answer is
therefore reproducible, cacheable, auditable and correct.

**Long-running inference is queued, never synchronous.** Body scan, form analysis and
nutrition scanning run as BullMQ jobs in `apps/worker` with progress streamed to the client.
An HTTP request must never wait on a vision model.

**Cost and safety controls:** per-org token budgets, response caching on deterministic
prompts, rate limits per user, and full prompt/response logging to `AuditLog` for AI actions.

---

## 8. Jobs, cache, storage

- **Redis + BullMQ** — AI inference, PDF/report generation, notification fan-out, WhatsApp
  delivery, scheduled billing runs, streak/XP recomputation. Consumers live in `apps/worker`
  so a slow AI job cannot starve the API's event loop.
- **Redis cache** — analytics aggregates (expensive, tolerant of 60s staleness), session
  lookups, rate-limit counters.
- **Cloudflare R2** — presigned direct-to-bucket uploads. Bytes never pass through the API.
  Buckets are private; reads use short-lived signed URLs.

---

## 9. Design system

`packages/ui` is the only place styling decisions exist.

- **Tailwind v4 CSS-first `@theme`** — one token file defines colour, spacing, radius,
  shadow, and typography scales for light and dark. Components consume tokens; components
  never hardcode a hex value.
- **shadcn/ui vendored into the package**, not installed per-app — so a fix to `Button`
  applies everywhere at once.
- **Motion is systematised.** A small set of named transitions (`enter`, `exit`, `springy`,
  `page`) rather than per-component Framer Motion values. This is what makes an interface
  feel coherent rather than merely animated.
- **Every data view ships four states**: loading (skeleton matched to final layout, not a
  spinner), empty (illustrated, with the primary action), error (recoverable), and populated.
  Enforced by a shared `DataView` primitive so a missing empty state is a compile-time gap,
  not a QA finding.
- **Accessibility via React Aria** for menus, dialogs, comboboxes and date pickers. Premium
  and inaccessible are contradictory.

---

## 10. Security & data protection

Baseline (Phase 0): HSTS with preload, strict CSP with nonces (no `unsafe-inline`), Helmet,
CSRF tokens on cookie-authenticated mutations, per-route rate limiting, parameterised queries
via Prisma only, encrypted secrets, audit logging, RBAC + RLS.

**Beyond the checklist — the data classification that actually matters here.** This product
stores progress photos, body-fat estimates, injury notes and dietary data. Under India's
DPDP Act 2023 this is personal data requiring purpose-limited consent, and body imagery is
about as sensitive as consumer data gets.

Therefore: explicit consent records per data category with timestamp and version; body
imagery in a separate private R2 bucket with short-lived signed reads and no public URL
ever minted; configurable retention with automatic expiry; a working member-initiated export
and erasure flow. This is built in Phase 1 alongside the schema, not retrofitted — retrofitting
consent onto an existing data model is a rewrite.

---

## 11. Performance budget

Targets are enforced in CI, not aspired to. Lighthouse CI fails the build below 95 on the
marketing site and below 90 on authenticated routes (a data-dense dashboard is legitimately
heavier than a landing page; pretending otherwise leads to gaming the metric).

- Server Components keep data-fetching off the client bundle.
- Route-level code splitting; charts and PDF rendering are dynamically imported (Recharts and
  React PDF are large and are not needed on first paint).
- `next/image` with R2 as the remote loader.
- Virtualised tables; cursor pagination everywhere (offset pagination degrades linearly and
  gyms accumulate rows forever).
- Analytics aggregates precomputed by scheduled jobs rather than computed per request.
- Bundle-size budget checked in CI so regressions are caught at PR time.

---

## 12. Testing & delivery

- **Unit** — Vitest, on services and pure logic, with repositories mocked.
- **Integration** — Testcontainers Postgres, real migrations, real Prisma. Includes an
  explicit **cross-tenant isolation suite**: for every tenant-scoped endpoint, assert that
  org A cannot read, update or delete org B's row. This suite is non-negotiable and runs on
  every PR.
- **E2E** — Playwright on the critical revenue paths: signup → member creation → payment →
  check-in.
- **CI (GitHub Actions)** — typecheck, lint, unit, integration, build, Lighthouse CI, bundle
  budget. Turbo-cached, so a docs change does not run the integration suite.
- **Deploy** — `apps/app` and `apps/web` to Vercel; `apps/api` and `apps/worker` to Render as
  Docker images; migrations run as a release step, never on boot.
