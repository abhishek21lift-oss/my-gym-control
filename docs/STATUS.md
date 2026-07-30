# Status

Last updated: 2026-07-28

A deliberately unflattering record of what exists. "Verified" means it was executed and
observed, not that it was written.

---

## Phase 0 — Foundation

### Done and verified

| Item | Evidence |
|---|---|
| Turborepo + pnpm workspaces with a version catalog | `pnpm install` resolves clean |
| `@mgc/contracts` — tenant, money, pagination, error envelope | `tsc` clean |
| Zod environment contract with production-only invariants | **15/15 unit tests pass** |
| `@mgc/db` — Prisma 7 on the `pg` driver adapter | `prisma generate` + `tsc` clean |
| Schema: `Organization`, `Branch`, `AuditLog` + enums | Migration applied |
| UUID v7 portability shim (native on PG18, pl/pgsql below) | Verified: native detected, shim skipped, valid v7 output |
| Local infra: Postgres 18, Redis 8, MinIO | All three containers healthy |
| NestJS API: bootstrap, DI, graceful shutdown | Boots and connects to Postgres |
| Health endpoints (live / ready / capabilities) | `200` with real DB latency |
| URI versioning (`/api/v1/…`) | Verified: unversioned path correctly `404`s |
| `ApiError` envelope on every failure | Verified: `{"code":"NOT_FOUND",…,"requestId":…}` |
| Security headers — HSTS+preload, strict CSP, nosniff, no-referrer | Verified in response headers |
| Request correlation ids, echoed as `X-Request-Id` | Verified in response headers |
| Two-tier rate limiting (burst + sustained) | Guard registered globally |
| GitHub Actions CI + gitleaks secret scan | **Written, not yet run** |
| `packages/ui` — OKLCH token system, light + dark | Typechecks; verified rendering in both themes |
| Primitives: Button, Card, Input, Badge, Skeleton, DataView, ThemeToggle | Rendered and inspected in the browser |
| `apps/app` — Next.js 16 shell, Geist fonts, security headers | Production build succeeds; 2 static routes |
| Design system reference route (`/`) | Verified: tokens resolve, theme switch flips every surface |

### Verified in the browser

Computed styles were read directly from the running page rather than eyeballed:

- `--accent` lifts from `oklch(0.55 …)` in light to `oklch(0.70 …)` in dark, and every
  consuming utility follows it.
- Surfaces, danger, and border tokens all switch correctly with the theme class.
- Geist loads; `font-variant-numeric: tabular-nums` is active, so figures align in tables.

One investigation worth recording: several elements appeared to keep their light-mode
colour after switching to dark. The cause was **not** the token system — the automation
pane does not composite frames, so CSS transitions that had started never advanced past
their first keyframe. Elements without a `transition` on `background-color` (body, a
freshly-inserted probe) reported dark correctly throughout, and suppressing transitions
made every element report correctly. No code change was needed.

### Not started — remaining Phase 0

| Item | Why it is not done |
|---|---|
| API test harness (Vitest + SWC for decorator metadata) | esbuild cannot emit decorator metadata, so this needs an SWC transform rather than Vitest's default |
| Portal route groups `(owner) (trainer) (member) (reception)` | They need auth and real data. Empty shells would be the placeholder work this project explicitly forbids — they land with Phase 1 and Phase 2. |

### Re-sequenced

`apps/web` (public marketing site) moved out of Phase 0 into **Phase 7**. The roadmap's
own rationale already said it depends on real pricing, real screenshots and a working AI
receptionist; scaffolding it in Phase 0 would guarantee rebuilding it. `apps/worker` is
similarly deferred to Phase 5, where the first queued job actually exists.

The `test` script was removed from `apps/api` rather than left pointing at a runner
with no tests. A green check for a suite that executes nothing is worse than no check.

---

## Phase 1 — Identity, tenancy & the audit spine

### Written and typechecking

| Item | State |
|---|---|
| Schema: `User`, `OrganizationMember`, `Role`, `Permission`, `RolePermission` | Written; migration not yet applied |
| Schema: `Session`, `Device`, `WebAuthnCredential`, `ConsentRecord` | Written; migration not yet applied |
| Prisma client extension — tenant injection, soft delete, actor stamping, audit | Written; typechecks |
| Model registry derived from Prisma's runtime datamodel, validated at construction | Written; typechecks |
| Audit redaction policy | **13/13 unit tests pass** |
| RLS migration — policies, restricted role, append-only audit grants | Written; **not yet applied** |
| Cross-tenant isolation suite — 30 assertions | Written; typechecks; **awaiting first CI run** |
| RLS suite — 20 assertions via `SET ROLE mgc_app_restricted` | Written; typechecks; **awaiting first CI run** |
| `tenantData()` type bridge | Written; typechecks |
| Render blueprint, Vercel config, migration workflow | Written; **awaiting first deploy** |

### Verification moved to CI

Docker Desktop cannot start on the development machine — its privileged helper service
requires elevation that is not available (`Cannot open com.docker.service`) — and no
native Postgres is installed. Rather than keep the security-critical suites unrun, the
authoritative verification is now **GitHub Actions**, which provisions a real Postgres 18
service container on every push and runs:

```
pnpm test:integration    # cross-tenant isolation + RLS suites
```

This is a better arrangement than it sounds. The two suites that matter most now run on
infrastructure nobody can locally misconfigure, on every commit, rather than depending on
a developer remembering to start a container.

**Status of the DB-dependent work: written, typechecked, awaiting its first CI run.**
"Verified" means executed, and until CI runs green on a push these are not verified.

Two additional local paths exist for anyone who wants one:
`pnpm db:up` (real Postgres binaries from `node_modules`, no Docker, no admin) and
`pnpm infra:up` (Docker Compose). **The former has never been successfully executed on
this machine** — resolution of the vendored binaries was fixed but the run was not
completed, so treat it as unproven until someone confirms it.

### Migration history rebuilt — a latent deploy blocker fixed

The original init migration sorted *before* the `uuidv7()` compatibility shim
(`20260727210222` < `20260728000000`). Prisma applies migrations in lexicographic order,
so on a fresh database every table creation would have run before `uuidv7()` existed. It
went unnoticed because local Postgres 18 has the function natively — but **it would have
failed on the first deploy to Supabase**, which runs Postgres 17.

History is now:

| Order | Migration | Purpose |
|---|---|---|
| 1 | `20260727200000_uuidv7_compat` | Installs `uuidv7()` when the server lacks it |
| 2 | `20260727210000_init_schema` | All 12 tables, 6 enums |
| 3 | `20260728010000_row_level_security` | Policies, restricted role, append-only audit |

The init migration was regenerated with `prisma migrate diff --from-empty --to-schema`,
which needs no database connection. Safe to rewrite because nothing is deployed yet.

### Design decisions worth knowing

**`User` is not tenant-scoped.** A person is one person: a trainer may work at two gyms,
and a member who moves cities keeps their history. The tenant boundary sits on
`OrganizationMember` instead. Tenant-scoping identity would force duplicate accounts and
make "which of these rows is really me" unanswerable.

**Roles are per-organization, including the built-in four.** A global role table makes
"rename Reception to Front Desk" or "our trainers can also take payments" impossible
without affecting every other gym. Seeding four rows at signup buys full customisation
forever.

**Eight models are exempt from tenant scoping**, each with a written reason enforced by a
test. Adding an exemption is a reviewable decision; forgetting to scope a model is not
possible, because scoping is derived from the schema.

**The extension depends on a Prisma internal.** Prisma 7 removed `Prisma.dmmf`; the
equivalent is `client._runtimeDataModel`. Depending on an internal for a security control
is normally indefensible, so its shape is validated at construction and cross-checked
against the public `Prisma.ModelName` enum. A Prisma upgrade that changes it produces a
**boot failure**, not silently disabled tenant filtering.

**Audit writes fail closed by default.** A platform advertising audit logging must not
accept unlogged writes. The cost — audit-table availability becomes a hard dependency for
mutations — is the right trade for financial and health records, and is configurable for
deployments with different obligations.

**RLS applies to a non-owner role, not to the API.** The API connects as owner and is
governed by the extension; `mgc_app_restricted` exists for direct database clients,
Supabase's `authenticated` role and the RLS tests, and for them the policies are absolute.
Enforcement is a property of the credential rather than of remembering to opt in.

### Not started — remaining Phase 1

| Item | Note |
|---|---|
| Supabase Auth integration (email/OTP, Google, JWKS verification) | Needs a provisioned Supabase project |
| WebAuthn passkey enrolment and assertion | Schema ready; SimpleWebAuthn wiring pending |
| CASL ability definitions shared by API guards and UI | After roles are seeded |
| Onboarding flow: create organization → first branch → invite staff | After auth |
| RLS test suite (via `SET ROLE mgc_app_restricted`) | Blocked with the rest on Docker |
| API test harness (Vitest + SWC) | Still outstanding from Phase 0 |

---

## Phases 2–9

Not started. See [ROADMAP.md](ROADMAP.md).

---

## Known deviations from the brief

| Brief says | Built as | Why |
|---|---|---|
| Six separate portal apps | One `apps/app` with four route groups + a separate `apps/web` | Six apps means six copies of auth, layout and design system — contradicting the brief's own "no duplicated code" rule. The route-group seam is preserved so they can be split later without backend changes. Confirmed with the product owner. |
| "Face ID", "Fingerprint", "Passkeys" as three features | One WebAuthn implementation | Face ID *is* the passkey UX on iOS — they are platform authenticators, not separate integrations |
| TypeScript (implied latest) | 5.9.3 | `@nestjs/cli` pins 5.9.3; NestJS DI needs `emitDecoratorMetadata` from the classic compiler |

---

## Open decisions

- **Supabase project** not yet provisioned. Auth (Phase 1) needs it. Until then
  `SUPABASE_*` is blank and `/health/capabilities` reports `supabase: false`.
- **Razorpay** chosen but no credentials yet. Needed for Phase 2.
- **AI provider keys** not set. Needed for Phase 5.

None of these block the phase currently in progress.
