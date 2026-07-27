# MY GYM CONTROL — Phased Roadmap

Nine phases. Each ships a **vertical slice** — schema → migration → API → contracts → UI →
tests → docs — so that at the end of every phase the product is deployable and demonstrable,
never half-wired. No phase ends with a stub.

A phase is done when: migrations applied, integration tests green (including the cross-tenant
isolation suite), all four UI states implemented, and CI passing.

---

## Phase 0 — Foundation

Monorepo, tooling, and the guardrails that everything after this depends on.

- Turborepo + pnpm workspaces; strict TypeScript base config; ESLint + Prettier.
- `apps/api` NestJS skeleton with health/readiness endpoints and structured logging.
- `apps/app` + `apps/web` Next.js 16 skeletons.
- `packages/db` with Prisma wired to Postgres; `packages/config`, `packages/contracts`.
- `packages/ui`: Tailwind v4 `@theme` token file, light/dark, typography scale, the base
  primitives (Button, Card, Input, Dialog, Sheet, Table, Toast) and the `DataView` state
  primitive.
- `docker-compose.yml` — Postgres + Redis for local development.
- GitHub Actions: typecheck, lint, test, build, Turbo remote cache.
- Env schema validated with Zod at boot — the app refuses to start on a missing variable
  rather than failing at 3am on the first request that needs it.

**Exit:** `pnpm dev` runs all surfaces; CI green; design tokens render in both themes.

---

## Phase 1 — Identity, tenancy & the audit spine

The load-bearing phase. Everything downstream inherits whatever we get right or wrong here,
so it is deliberately front-loaded.

- Schema: `Organization`, `Branch`, `User`, `Membership` (user↔org), `Role`, `Permission`,
  `RolePermission`, `AuditLog`, `ConsentRecord`, `Device`, `Session`.
- **Prisma client extension**: tenant injection, soft delete, `createdBy`/`updatedBy`, audit
  writes. Built once, applies to every model added afterwards.
- **RLS policies** on all tenant tables.
- Supabase Auth integration: email/OTP, Google, JWKS verification in NestJS.
- WebAuthn passkeys (covers Face ID and fingerprint), 2FA, device registry, session history
  and revocation.
- CASL ability definitions shared by API guards and UI.
- Onboarding flow: create organisation → first branch → invite staff.
- **Cross-tenant isolation test suite** established here and extended by every later phase.

**Exit:** two organisations coexist in one database and are provably unable to see each
other, verified by tests, at both the application and database layer.

---

## Phase 2 — Core gym operations

The part that replaces the register book. This is the phase that makes the product sellable.

- Members: profile, photo, emergency contact, medical notes, documents, tags.
- Membership plans, subscriptions, freezes, upgrades, transfers, expiry.
- Payments: invoices, receipts, part-payments, dues, refunds, gateway integration and
  webhook reconciliation.
- Attendance: check-in/out, QR and biometric-device ingestion, live occupancy.
- Reception dashboard: fast member search, walk-in capture, day sheet, collections.
- Staff and trainer records, shifts, assignment.

**Exit:** a gym can run a full day of real operations on this alone.

---

## Phase 3 — Training & member experience

- Exercise library with media; workout templates; program builder; assignment to members.
- Workout logging, sets/reps/weight, personal records, progressive-overload tracking.
- Nutrition: food database with Indian foods, meal plans, macro targets, daily logging.
- Progress: weight, measurements, photos (consent-gated per Phase 1), charts.
- Trainer portal: client roster, session scheduling, PT package tracking, notes.
- Member portal + PWA: today's workout, history, plan, dues, check-in.

**Exit:** a trainer runs their full client load in-product; a member has a reason to open the
app daily.

---

## Phase 4 — Analytics, finance & reporting

- Aggregate pipeline: scheduled jobs precompute daily/weekly/monthly rollups.
- Metrics: MRR, ARR, LTV, churn, retention curves, cohort analysis, conversion funnel,
  trainer KPIs, cash flow, attendance heatmaps.
- Owner dashboard and dedicated Analytics + Finance dashboards.
- Report builder with scheduled email delivery; PDF export via React PDF in the worker.

**Exit:** every number in the brief's analytics list is real, drill-downable, and derived
from the aggregate pipeline rather than computed per page load.

---

## Phase 5 — AI platform & Copilot

Deliberately after Phase 4: the Copilot answers questions using the analytics tools built
there. Building it earlier would mean building those tools twice.

- `packages/ai` gateway: `LlmProvider` interface, Anthropic/OpenAI/Gemini adapters,
  task-based routing, retries, streaming, token accounting, per-org budgets.
- **Business Copilot** — typed tool-calling over the Phase 4 analytics services. Answers
  "why is revenue down", "who is likely to cancel", "predict next month" by calling real
  functions and interpreting real results. No generated SQL (see ARCHITECTURE §7).
- **AI Fitness Coach** — per-member, grounded in that member's actual logged history:
  workout generation, substitutions, recovery, nutrition, motivation.
- **AI Progress Analysis** — narrative insights over Phase 3 data, not just charts.

**Exit:** every Copilot answer traces to a named tool call and reproducible numbers.

---

## Phase 6 — AI vision

Queue-backed, since all three are long-running multimodal jobs.

- **Body Scan** — front/side/back upload → body-fat estimate, symmetry, posture, WHR,
  comparison over time, before/after slider.
- **Form Analysis** — video upload → pose extraction → per-lift heuristics (squat depth, bar
  path, lockout, spinal flexion, knee valgus, bar speed) → corrections.
- **Nutrition Scanner** — meal photo → items, macros, micros, Indian-dish recognition,
  healthier alternatives, one-tap log into Phase 3 nutrition.

Every output carries an explicit confidence level and a **"this is an estimate, not medical
advice"** boundary. Body-fat percentages and posture assessments from photographs are
inherently approximate; presenting them as clinical measurements would be both wrong and a
liability. Estimates are framed as trends, which is what they are actually good at.

**Exit:** all three run as jobs with progress UI, retries, and graceful degradation when a
provider is down.

---

## Phase 7 — Growth engine

- CRM: leads, sources, pipeline, follow-up tasks, trial bookings, conversion tracking.
- **AI Receptionist** — website widget + WhatsApp Business: answers pricing, books trials,
  schedules PT, captures leads into CRM, escalates to a human cleanly.
- **Gamification** — XP, levels, streaks, badges, coins, leaderboards, weekly/monthly
  challenges, rewards. Computed in the worker, not on read.
- **Transformation Studio** — auto-generated before/after graphics, reels, certificates,
  client reports, testimonials.
- **Voice Workout Assistant** — hands-free logging during a set: next exercise, timers,
  "log 100 kg", finish, skip.
- Notifications: push, email, WhatsApp, in-app, with per-user preferences and quiet hours.

**Exit:** a lead can arrive from the website and become a paying, engaged member without
staff touching a keyboard.

---

## Phase 8 — Inventory, settings & administration

- Inventory: stock, suppliers, purchase orders, POS for supplements and merchandise, low-stock
  alerts, linked to the Phase 2 payment ledger.
- Organisation settings, branding, tax configuration, invoice templates, locales.
- Role editor, IP restrictions, data export, retention policy configuration.

---

## Phase 9 — Hardening & launch

- Full security review: threat model, dependency audit, CSP tightening, penetration pass
  against the tenancy boundary specifically.
- Load testing to a realistic ceiling (multi-branch chain, peak 7pm check-in burst).
- Lighthouse and bundle budgets enforced as CI gates.
- Backup, restore and disaster-recovery rehearsal — rehearsed, not documented and untested.
- Observability: error tracking, tracing, uptime and job-queue alerting.
- Operator documentation and in-app onboarding.

---

## Sequencing rationale

**Why tenancy before features.** Retrofitting `organizationId` onto twenty existing tables is
not a refactor, it is a rewrite plus a data migration plus a security incident waiting to be
discovered. It costs one phase now or the project later.

**Why analytics before AI.** The Copilot's value is entirely determined by the quality of the
tools it can call. Build the tools first and the Copilot is a thin, reliable layer; build the
Copilot first and it hallucinates over data that does not exist yet.

**Why the marketing site is late (Phase 7).** It depends on real pricing, real screenshots and
a working AI receptionist. Built first, it would be rebuilt.

**Why gamification is not Phase 2.** It multiplies engagement with an already-working product
and does nothing for one that is not. It is a multiplier, not a foundation.
