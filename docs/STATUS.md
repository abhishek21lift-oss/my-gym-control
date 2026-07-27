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

### Not started — remaining Phase 0

| Item | Why it is not done |
|---|---|
| `packages/ui` — Tailwind v4 tokens, primitives, `DataView` | Next in sequence |
| `apps/app` — Next.js shell with the four portal route groups | Depends on `packages/ui` |
| `apps/web` — public marketing site | Depends on `packages/ui` |
| `apps/worker` — BullMQ consumers | Not needed until Phase 5 |
| API test harness (Vitest + SWC for decorator metadata) | esbuild cannot emit decorator metadata, so this needs an SWC transform rather than Vitest's default |

The `test` script was removed from `apps/api` rather than left pointing at a runner
with no tests. A green check for a suite that executes nothing is worse than no check.

---

## Phases 1–9

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
