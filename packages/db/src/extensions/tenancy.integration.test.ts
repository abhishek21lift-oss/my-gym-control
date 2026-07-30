import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../client';
import type { PrismaClient } from '../generated/client/client';
import { MissingTenantContextError, runWithTenantContext } from '../tenant-context';
import { createModelRegistry, TENANCY_EXEMPT_MODELS } from './model-metadata';
import { tenantData } from './tenant-input';
import { bypassingTenancy, includingSoftDeleted, withTenancy } from './tenancy';

/**
 * Cross-tenant isolation suite.
 *
 * This is the non-negotiable test suite referenced in docs/ARCHITECTURE.md §12. Every
 * phase that adds a tenant-scoped model extends it.
 *
 * It runs against a real Postgres, not a mock. Tenant isolation is enforced partly by
 * Prisma's query construction and partly by the database, and a mocked client would
 * assert only that our code called the functions we expected it to call — which is
 * precisely the thing that is not in question. What is in question is whether org A can
 * read org B's rows, and only a database can answer that.
 */

const DATABASE_URL = process.env['DATABASE_URL'];

let base: PrismaClient;
let db: ReturnType<typeof withTenancy>;

/** Two tenants, and one actor in each. */
const orgA = { id: '', userId: '', branchId: '' };
const orgB = { id: '', userId: '', branchId: '' };

const suffix = Date.now().toString(36);

/** Runs `fn` as the given organization's actor. */
const asOrgA = <T>(fn: () => T): T =>
  runWithTenantContext({ organizationId: orgA.id, branchId: null, userId: orgA.userId }, fn);

const asOrgB = <T>(fn: () => T): T =>
  runWithTenantContext({ organizationId: orgB.id, branchId: null, userId: orgB.userId }, fn);

beforeAll(async () => {
  if (!DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required. Run `pnpm infra:up && pnpm db:migrate` first, or use ' +
        '`pnpm --filter @mgc/db test:integration`.',
    );
  }

  base = createPrismaClient({ databaseUrl: DATABASE_URL });
  db = withTenancy(base);

  // Organizations and users are tenancy-exempt, so they are created on the base client.
  const [a, b] = await Promise.all([
    base.organization.create({
      data: { slug: `iso-a-${suffix}`, name: 'Iron Works A', contactEmail: `a-${suffix}@t.test` },
    }),
    base.organization.create({
      data: { slug: `iso-b-${suffix}`, name: 'Iron Works B', contactEmail: `b-${suffix}@t.test` },
    }),
  ]);
  orgA.id = a.id;
  orgB.id = b.id;

  const [ua, ub] = await Promise.all([
    base.user.create({
      data: { email: `owner-a-${suffix}@t.test`, fullName: 'Owner A' },
    }),
    base.user.create({
      data: { email: `owner-b-${suffix}@t.test`, fullName: 'Owner B' },
    }),
  ]);
  orgA.userId = ua.id;
  orgB.userId = ub.id;

  // One branch per organization, each created through the extension in its own context.
  const branchA = await asOrgA(() =>
    db.branch.create({ data: tenantData({ name: 'A — Main', code: 'MAIN' }) }),
  );
  const branchB = await asOrgB(() =>
    db.branch.create({ data: tenantData({ name: 'B — Main', code: 'MAIN' }) }),
  );
  orgA.branchId = branchA.id;
  orgB.branchId = branchB.id;
});

afterAll(async () => {
  if (!base) return;
  // Hard delete, bypassing the soft-delete rewrite, so repeated runs stay clean.
  for (const table of ['audit_logs', 'branches', 'organization_members', 'roles']) {
    await base.$executeRawUnsafe(
      `DELETE FROM ${table} WHERE organization_id IN ($1::uuid, $2::uuid)`,
      orgA.id,
      orgB.id,
    );
  }
  await base.$executeRawUnsafe(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, orgA.userId, orgB.userId);
  await base.$executeRawUnsafe(`DELETE FROM organizations WHERE id IN ($1::uuid, $2::uuid)`, orgA.id, orgB.id);
  await base.$disconnect();
});

// ---------------------------------------------------------------------------

describe('model registry', () => {
  it('protects every model that carries an organizationId', () => {
    const registry = createModelRegistry(base);
    // Anything with an organizationId column that is not in the exemption list must be
    // scoped. This is the assertion that makes "someone added a model and forgot" fail
    // as a test rather than as a data leak.
    expect(registry.exemptWithOrganizationId()).toEqual([]);
  });

  it('has no exemptions for models that no longer exist', () => {
    // A stale exemption reads as deliberate protection but grants none.
    expect(createModelRegistry(base).staleExemptions()).toEqual([]);
  });

  it('scopes the tenant-owned models present in Phase 1', () => {
    const scoped = createModelRegistry(base).tenantScopedModels();
    expect(scoped).toEqual(
      expect.arrayContaining([
        'Branch',
        'OrganizationMember',
        'Role',
        'RolePermission',
        'ConsentRecord',
      ]),
    );
  });

  it('documents a reason for every exemption', () => {
    for (const [model, reason] of Object.entries(TENANCY_EXEMPT_MODELS)) {
      expect(reason.length, `${model} needs a reason`).toBeGreaterThan(10);
    }
  });
});

describe('tenant context is mandatory', () => {
  it('refuses to read tenant data with no context established', async () => {
    // The critical property: no context means an error, never an unscoped result set.
    await expect(db.branch.findMany()).rejects.toThrow(MissingTenantContextError);
  });

  it('refuses to write tenant data with no context established', async () => {
    await expect(db.branch.create({ data: tenantData({ name: 'Orphan', code: 'ORPH' }) })).rejects.toThrow(
      MissingTenantContextError,
    );
  });
});

describe('read isolation', () => {
  it('findMany returns only the acting organization’s rows', async () => {
    const seen = await asOrgA(() => db.branch.findMany());
    expect(seen).toHaveLength(1);
    expect(seen[0]?.id).toBe(orgA.branchId);
  });

  it('findUnique cannot fetch another organization’s row by primary key', async () => {
    // Knowing the exact id must not be enough — this is the attack that a forgotten
    // `where: { organizationId }` would allow.
    const stolen = await asOrgA(() => db.branch.findUnique({ where: { id: orgB.branchId } }));
    expect(stolen).toBeNull();
  });

  it('findFirst cannot fetch another organization’s row by primary key', async () => {
    const stolen = await asOrgA(() => db.branch.findFirst({ where: { id: orgB.branchId } }));
    expect(stolen).toBeNull();
  });

  it('findUniqueOrThrow throws rather than leaking another organization’s row', async () => {
    await expect(
      asOrgA(() => db.branch.findUniqueOrThrow({ where: { id: orgB.branchId } })),
    ).rejects.toThrow();
  });

  it('count is scoped', async () => {
    expect(await asOrgA(() => db.branch.count())).toBe(1);
    expect(await asOrgB(() => db.branch.count())).toBe(1);
  });

  it('a caller-supplied organizationId cannot widen the scope', async () => {
    // The injected predicate is applied last, so a hostile filter cannot override it.
    const attempted = await asOrgA(() =>
      db.branch.findMany({ where: { organizationId: orgB.id } }),
    );
    expect(attempted).toEqual([]);
  });
});

describe('write stamping', () => {
  it('sets organizationId and createdBy without the caller supplying them', async () => {
    const created = await asOrgA(() =>
      db.branch.create({ data: tenantData({ name: 'A — Annexe', code: `ANX-${suffix}` }) }),
    );
    expect(created.organizationId).toBe(orgA.id);
    expect(created.createdBy).toBe(orgA.userId);
  });

  it('overrides a caller-supplied organizationId', async () => {
    // A compromised or buggy caller must not be able to plant a row in another tenant.
    const created = await asOrgA(() =>
      db.branch.create({
        data: tenantData({ name: 'A — Planted', code: `PLT-${suffix}`, organizationId: orgB.id }),
      }),
    );
    expect(created.organizationId).toBe(orgA.id);

    const visibleToB = await asOrgB(() => db.branch.findUnique({ where: { id: created.id } }));
    expect(visibleToB).toBeNull();
  });

  it('sets updatedBy on update', async () => {
    const updated = await asOrgA(() =>
      db.branch.update({ where: { id: orgA.branchId }, data: { city: 'Pune' } }),
    );
    expect(updated.updatedBy).toBe(orgA.userId);
    expect(updated.city).toBe('Pune');
  });
});

describe('write isolation', () => {
  it('update cannot modify another organization’s row', async () => {
    await expect(
      asOrgA(() => db.branch.update({ where: { id: orgB.branchId }, data: { city: 'Hacked' } })),
    ).rejects.toThrow();

    const untouched = await asOrgB(() => db.branch.findUnique({ where: { id: orgB.branchId } }));
    expect(untouched?.city).not.toBe('Hacked');
  });

  it('updateMany cannot modify another organization’s rows', async () => {
    const result = await asOrgA(() =>
      db.branch.updateMany({ where: { id: orgB.branchId }, data: { city: 'Hacked' } }),
    );
    expect(result.count).toBe(0);
  });

  it('delete cannot remove another organization’s row', async () => {
    await expect(
      asOrgA(() => db.branch.delete({ where: { id: orgB.branchId } })),
    ).rejects.toThrow();

    const stillThere = await asOrgB(() => db.branch.findUnique({ where: { id: orgB.branchId } }));
    expect(stillThere).not.toBeNull();
  });
});

describe('soft delete', () => {
  it('rewrites delete as an update and hides the row from reads', async () => {
    const doomed = await asOrgA(() =>
      db.branch.create({ data: tenantData({ name: 'A — Closing', code: `CLS-${suffix}` }) }),
    );

    await asOrgA(() => db.branch.delete({ where: { id: doomed.id } }));

    // Invisible through the extension...
    expect(await asOrgA(() => db.branch.findUnique({ where: { id: doomed.id } }))).toBeNull();

    // ...but still present in the table, with deletedAt set.
    const raw = await base.branch.findUnique({ where: { id: doomed.id } });
    expect(raw).not.toBeNull();
    expect(raw?.deletedAt).toBeInstanceOf(Date);
  });

  it('exposes soft-deleted rows only inside includingSoftDeleted()', async () => {
    const doomed = await asOrgA(() =>
      db.branch.create({ data: tenantData({ name: 'A — Restorable', code: `RST-${suffix}` }) }),
    );
    await asOrgA(() => db.branch.delete({ where: { id: doomed.id } }));

    const hidden = await asOrgA(() => db.branch.findUnique({ where: { id: doomed.id } }));
    expect(hidden).toBeNull();

    const revealed = await asOrgA(() =>
      includingSoftDeleted(() => db.branch.findUnique({ where: { id: doomed.id } })),
    );
    expect(revealed?.id).toBe(doomed.id);
  });

  it('still enforces tenant scope inside includingSoftDeleted()', async () => {
    // The soft-delete escape hatch must not double as a tenancy escape hatch.
    const stolen = await asOrgA(() =>
      includingSoftDeleted(() => db.branch.findUnique({ where: { id: orgB.branchId } })),
    );
    expect(stolen).toBeNull();
  });

  it('deleteMany soft-deletes only the acting organization’s rows', async () => {
    const before = await asOrgB(() => db.branch.count());
    await asOrgA(() => db.branch.deleteMany({ where: { code: { startsWith: 'ANX-' } } }));
    expect(await asOrgB(() => db.branch.count())).toBe(before);
  });
});

describe('audit trail', () => {
  it('records a CREATE with the actor and no prior state', async () => {
    const created = await asOrgA(() =>
      db.branch.create({ data: tenantData({ name: 'A — Audited', code: `AUD-${suffix}` }) }),
    );

    const entries = await base.auditLog.findMany({
      where: { organizationId: orgA.id, entity: 'Branch', entityId: created.id },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('CREATE');
    expect(entries[0]?.actorId).toBe(orgA.userId);
    expect(entries[0]?.before).toBeNull();
    expect(entries[0]?.after).toMatchObject({ name: 'A — Audited' });
  });

  it('records an UPDATE with both before and after state', async () => {
    const target = await asOrgA(() =>
      db.branch.create({ data: tenantData({ name: 'A — Before', code: `UPD-${suffix}` }) }),
    );
    await asOrgA(() =>
      db.branch.update({ where: { id: target.id }, data: { name: 'A — After' } }),
    );

    const update = await base.auditLog.findFirst({
      where: { entity: 'Branch', entityId: target.id, action: 'UPDATE' },
    });

    expect(update?.before).toMatchObject({ name: 'A — Before' });
    expect(update?.after).toMatchObject({ name: 'A — After' });
  });

  it('records a DELETE with the prior state, so a soft delete is reconstructable', async () => {
    const target = await asOrgA(() =>
      db.branch.create({ data: tenantData({ name: 'A — Deleted', code: `DEL-${suffix}` }) }),
    );
    await asOrgA(() => db.branch.delete({ where: { id: target.id } }));

    const entry = await base.auditLog.findFirst({
      where: { entity: 'Branch', entityId: target.id, action: 'DELETE' },
    });

    expect(entry?.before).toMatchObject({ name: 'A — Deleted' });
    expect(entry?.after).toBeNull();
  });

  it('attributes audit rows to the acting organization only', async () => {
    const leaked = await base.auditLog.count({
      where: { organizationId: orgB.id, entity: 'Branch', entityId: orgA.branchId },
    });
    expect(leaked).toBe(0);
  });

  it('redacts credential-shaped fields instead of copying them into the log', async () => {
    const role = await asOrgA(() =>
      db.role.create({ data: tenantData({ key: `custom-${suffix}`, name: 'Custom' }) }),
    );

    // OrganizationMember carries inviteTokenHash — a credential that must never be
    // duplicated into an append-only, long-retention table.
    const member = await asOrgA(() =>
      db.organizationMember.create({
        data: tenantData({
          userId: orgA.userId,
          roleId: role.id,
          inviteTokenHash: 'super-secret-invite-token-hash',
        }),
      }),
    );

    const entry = await base.auditLog.findFirst({
      where: { entity: 'OrganizationMember', entityId: member.id },
    });

    const after = entry?.after as Record<string, unknown> | null;
    expect(after?.['inviteTokenHash']).toBe('[redacted]');
    expect(JSON.stringify(after)).not.toContain('super-secret-invite-token-hash');
  });
});

describe('bypassingTenancy', () => {
  it('requires a written reason', () => {
    expect(() => bypassingTenancy('', () => undefined)).toThrow(/non-empty reason/);
    expect(() => bypassingTenancy('   ', () => undefined)).toThrow(/non-empty reason/);
  });

  it('reads across tenants when explicitly bypassed', async () => {
    const all = await bypassingTenancy('isolation suite: verify bypass works', () =>
      db.branch.findMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } }),
    );
    const orgs = new Set(all.map((b) => b.organizationId));
    expect(orgs.has(orgA.id)).toBe(true);
    expect(orgs.has(orgB.id)).toBe(true);
  });

  it('does not leak the bypass outside its callback', async () => {
    await bypassingTenancy('isolation suite: scope check', async () => {
      await db.branch.findMany();
    });
    // Back outside, the context requirement applies again.
    await expect(db.branch.findMany()).rejects.toThrow(MissingTenantContextError);
  });
});
