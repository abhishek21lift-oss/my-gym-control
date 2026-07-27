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
