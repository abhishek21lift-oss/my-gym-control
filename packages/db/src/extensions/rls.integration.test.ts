import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

/**
 * Row Level Security suite — the *second*, independent isolation layer.
 *
 * The companion suite (tenancy.integration.test.ts) proves the Prisma extension scopes
 * queries. This one proves the database refuses to serve cross-tenant rows even when the
 * extension is not in the picture at all — which is the case for Supabase's direct client
 * access, `$queryRaw`, analytics connections, and any future service with its own
 * credentials.
 *
 * It deliberately uses `pg` rather than Prisma. Going through Prisma would re-introduce
 * the very layer this suite exists to test independently of, and the assertions need
 * `SET ROLE` and raw SQL that Prisma does not expose.
 *
 * Every case runs inside a transaction using `SET LOCAL`, so the role and tenant
 * settings are reverted on rollback and cannot leak into the next case.
 */

const DATABASE_URL = process.env['DATABASE_URL'];

let admin: Client;

const orgA = { id: '', userId: '', branchId: '' };
const orgB = { id: '', userId: '', branchId: '' };

const suffix = Date.now().toString(36);

/**
 * Runs `fn` inside a transaction, acting as the restricted role with the given tenant
 * and user context. Always rolls back.
 */
async function asRestricted<T>(
  context: { organizationId?: string; userId?: string },
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  await admin.query('BEGIN');
  try {
    // Custom GUCs are set before switching role; SET LOCAL scopes both to this
    // transaction so nothing survives the rollback.
    if (context.organizationId) {
      await admin.query(`SET LOCAL app.organization_id = '${context.organizationId}'`);
    }
    if (context.userId) {
      await admin.query(`SET LOCAL app.user_id = '${context.userId}'`);
    }
    await admin.query('SET LOCAL ROLE mgc_app_restricted');
    return await fn(admin);
  } finally {
    await admin.query('ROLLBACK');
  }
}

beforeAll(async () => {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required for the RLS suite.');

  admin = new Client({ connectionString: DATABASE_URL });
  await admin.connect();

  // Fixtures are created as the owner, which is exempt from RLS by design — see the
  // header of the row_level_security migration.
  const org = async (slug: string, name: string): Promise<string> => {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO organizations (slug, name, contact_email) VALUES ($1, $2, $3) RETURNING id`,
      [slug, name, `${slug}@t.test`],
    );
    return rows[0]!.id;
  };

  orgA.id = await org(`rls-a-${suffix}`, 'RLS A');
  orgB.id = await org(`rls-b-${suffix}`, 'RLS B');

  const user = async (email: string): Promise<string> => {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id`,
      [email, 'RLS User'],
    );
    return rows[0]!.id;
  };

  orgA.userId = await user(`rls-a-${suffix}@t.test`);
  orgB.userId = await user(`rls-b-${suffix}@t.test`);

  const branch = async (organizationId: string, code: string): Promise<string> => {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO branches (organization_id, name, code) VALUES ($1, $2, $3) RETURNING id`,
      [organizationId, `Branch ${code}`, code],
    );
    return rows[0]!.id;
  };

  orgA.branchId = await branch(orgA.id, `RA-${suffix}`);
  orgB.branchId = await branch(orgB.id, `RB-${suffix}`);
});

afterAll(async () => {
  if (!admin) return;
  await admin.query(`DELETE FROM branches WHERE organization_id = ANY($1::uuid[])`, [
    [orgA.id, orgB.id],
  ]);
  await admin.query(`DELETE FROM audit_logs WHERE organization_id = ANY($1::uuid[])`, [
    [orgA.id, orgB.id],
  ]);
  await admin.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[orgA.userId, orgB.userId]]);
  await admin.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[orgA.id, orgB.id]]);
  await admin.end();
});

// ---------------------------------------------------------------------------

describe('policy installation', () => {
  it('enables row level security on every tenant-scoped table', async () => {
    const { rows } = await admin.query<{ tablename: string; rowsecurity: boolean }>(
      `SELECT tablename, rowsecurity FROM pg_tables
        WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [
        [
          'organizations',
          'branches',
          'organization_members',
          'roles',
          'role_permissions',
          'consent_records',
          'audit_logs',
          'users',
          'sessions',
          'devices',
          'webauthn_credentials',
          'permissions',
        ],
      ],
    );

    expect(rows).toHaveLength(12);
    const unprotected = rows.filter((r) => !r.rowsecurity).map((r) => r.tablename);
    expect(unprotected).toEqual([]);
  });

  it('resolves the tenant from a session setting', async () => {
    const value = await asRestricted({ organizationId: orgA.id }, async (c) => {
      const { rows } = await c.query<{ id: string | null }>(
        'SELECT app_current_organization_id() AS id',
      );
      return rows[0]?.id ?? null;
    });
    expect(value).toBe(orgA.id);
  });

  it('resolves to NULL when nothing is set, denying rather than granting', async () => {
    const value = await asRestricted({}, async (c) => {
      const { rows } = await c.query<{ id: string | null }>(
        'SELECT app_current_organization_id() AS id',
      );
      return rows[0]?.id ?? null;
    });
    expect(value).toBeNull();
  });

  it('resolves to NULL on a malformed setting instead of raising', async () => {
    // A policy that errors is a policy that can be used to probe; a policy that denies
    // is not. The function swallows bad input and returns NULL, which fails closed.
    await admin.query('BEGIN');
    try {
      await admin.query(`SET LOCAL app.organization_id = 'not-a-uuid'`);
      await admin.query('SET LOCAL ROLE mgc_app_restricted');
      const { rows } = await admin.query<{ id: string | null }>(
        'SELECT app_current_organization_id() AS id',
      );
      expect(rows[0]?.id).toBeNull();
    } finally {
      await admin.query('ROLLBACK');
    }
  });
});

describe('tenant read isolation', () => {
  it('shows only the acting organization’s branches', async () => {
    const ids = await asRestricted({ organizationId: orgA.id }, async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM branches');
      return rows.map((r) => r.id);
    });
    expect(ids).toEqual([orgA.branchId]);
  });

  it('hides another organization’s branch even when queried by primary key', async () => {
    const rows = await asRestricted({ organizationId: orgA.id }, async (c) => {
      const result = await c.query('SELECT id FROM branches WHERE id = $1', [orgB.branchId]);
      return result.rowCount;
    });
    expect(rows).toBe(0);
  });

  it('shows nothing at all with no tenant context', async () => {
    const rows = await asRestricted({}, async (c) => {
      const result = await c.query('SELECT id FROM branches');
      return result.rowCount;
    });
    expect(rows).toBe(0);
  });

  it('scopes organizations to the acting tenant’s own row', async () => {
    const ids = await asRestricted({ organizationId: orgA.id }, async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM organizations');
      return rows.map((r) => r.id);
    });
    expect(ids).toEqual([orgA.id]);
  });
});

describe('tenant write isolation', () => {
  it('refuses an insert that would plant a row in another organization', async () => {
    // WITH CHECK, not just USING. Without it a session could insert rows it can never
    // read back — which is still a cross-tenant write.
    await expect(
      asRestricted({ organizationId: orgA.id }, async (c) =>
        c.query(
          `INSERT INTO branches (organization_id, name, code) VALUES ($1, $2, $3)`,
          [orgB.id, 'Planted', `PL-${suffix}`],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('allows an insert into the acting organization', async () => {
    const inserted = await asRestricted({ organizationId: orgA.id }, async (c) => {
      const result = await c.query(
        `INSERT INTO branches (organization_id, name, code) VALUES ($1, $2, $3)`,
        [orgA.id, 'Legitimate', `LG-${suffix}`],
      );
      return result.rowCount;
    });
    expect(inserted).toBe(1);
  });

  it('updates zero rows when targeting another organization', async () => {
    const affected = await asRestricted({ organizationId: orgA.id }, async (c) => {
      const result = await c.query('UPDATE branches SET city = $1 WHERE id = $2', [
        'Hacked',
        orgB.branchId,
      ]);
      return result.rowCount;
    });
    expect(affected).toBe(0);
  });

  it('deletes zero rows when targeting another organization', async () => {
    const affected = await asRestricted({ organizationId: orgA.id }, async (c) => {
      const result = await c.query('DELETE FROM branches WHERE id = $1', [orgB.branchId]);
      return result.rowCount;
    });
    expect(affected).toBe(0);
  });
});

describe('audit log is append-only', () => {
  beforeAll(async () => {
    await admin.query(
      `INSERT INTO audit_logs (organization_id, actor_id, action, entity, entity_id)
       VALUES ($1, $2, 'CREATE', 'Branch', $3)`,
      [orgA.id, orgA.userId, orgA.branchId],
    );
  });

  it('permits reading own-tenant entries', async () => {
    const count = await asRestricted({ organizationId: orgA.id }, async (c) => {
      const result = await c.query('SELECT id FROM audit_logs');
      return result.rowCount ?? 0;
    });
    expect(count).toBeGreaterThan(0);
  });

  it('hides another tenant’s entries', async () => {
    const count = await asRestricted({ organizationId: orgB.id }, async (c) => {
      const result = await c.query('SELECT id FROM audit_logs WHERE organization_id = $1', [
        orgA.id,
      ]);
      return result.rowCount ?? 0;
    });
    expect(count).toBe(0);
  });

  it('refuses UPDATE at the privilege level', async () => {
    // Enforced by a revoked grant rather than a policy: an audit trail the application
    // can rewrite is not evidence of anything.
    await expect(
      asRestricted({ organizationId: orgA.id }, async (c) =>
        c.query(`UPDATE audit_logs SET action = 'LOGIN'`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('refuses DELETE at the privilege level', async () => {
    await expect(
      asRestricted({ organizationId: orgA.id }, async (c) => c.query('DELETE FROM audit_logs')),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('user-owned tables', () => {
  it('shows a person only their own user row', async () => {
    const ids = await asRestricted({ userId: orgA.userId }, async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM users');
      return rows.map((r) => r.id);
    });
    expect(ids).toEqual([orgA.userId]);
  });

  it('hides other people’s user rows even by primary key', async () => {
    const count = await asRestricted({ userId: orgA.userId }, async (c) => {
      const result = await c.query('SELECT id FROM users WHERE id = $1', [orgB.userId]);
      return result.rowCount;
    });
    expect(count).toBe(0);
  });

  it('shows no users with no user context', async () => {
    const count = await asRestricted({}, async (c) => {
      const result = await c.query('SELECT id FROM users');
      return result.rowCount;
    });
    expect(count).toBe(0);
  });
});

describe('permission catalogue', () => {
  it('is readable without any tenant context, being global metadata', async () => {
    await expect(
      asRestricted({}, async (c) => c.query('SELECT id FROM permissions')),
    ).resolves.toBeDefined();
  });

  it('is not writable by the application role', async () => {
    await expect(
      asRestricted({}, async (c) =>
        c.query(`INSERT INTO permissions (key, resource, action) VALUES ('x.y', 'x', 'y')`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
