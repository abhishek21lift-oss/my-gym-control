-- =============================================================================
-- Row Level Security — the second, independent tenant isolation layer.
--
-- The Prisma client extension (packages/db/src/extensions/tenancy.ts) is the primary
-- control for traffic arriving through the NestJS API. This layer exists because that
-- is not the only path to the data:
--
--   * the Next.js apps talk to Supabase directly for auth, storage and realtime;
--   * `$queryRaw` bypasses the extension by definition;
--   * a future service, script or BI tool may connect with its own credentials.
--
-- Two controls with independent failure modes is the whole point. A bug in the
-- extension does not disable RLS, and a missing policy does not disable the extension.
--
-- ## Who this applies to
--
-- Postgres exempts a table's owner from RLS unless FORCE ROW LEVEL SECURITY is set.
-- That exemption is used deliberately here:
--
--   * The API connects as the owner. It is governed by layer 1, and it must be able to
--     serve cross-tenant platform operations (billing sweeps, admin tooling) without
--     smuggling an organization id through a session variable — which is unsafe with a
--     transaction pooler, where a session GUC can outlive the request that set it.
--
--   * `mgc_app_restricted`, created below, is a NON-owner role with DML only. Direct
--     database clients, Supabase's `authenticated` role, analytics connections and the
--     RLS test suite all act through it, and for them the policies are absolute.
--
-- Enforcement is therefore a property of the credential, not of remembering to opt in.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tenant resolution
-- -----------------------------------------------------------------------------

/**
 * The organization the current database session is acting as, or NULL.
 *
 * Reads two sources so one migration works both locally and on Supabase:
 *
 *   1. `app.organization_id` — a plain session/transaction GUC, used by tests and by
 *      any direct client we control.
 *   2. `request.jwt.claims` — the setting PostgREST and Supabase populate from the
 *      verified JWT. Reading the claim means the policy trusts the token Supabase
 *      already validated, rather than anything the client can assert on its own.
 *
 * Both use the two-argument form of current_setting(), which returns NULL instead of
 * raising when the setting is absent — so this resolves cleanly on a vanilla Postgres
 * where `request.jwt.claims` never exists.
 *
 * STABLE, not IMMUTABLE: the value is fixed within a statement but varies by session,
 * which is exactly what STABLE means and what lets the planner cache it per query.
 */
CREATE OR REPLACE FUNCTION app_current_organization_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
-- Pinned search_path: without it, a caller could prepend a schema containing a
-- malicious `current_setting` and hijack a SECURITY-sensitive function.
SET search_path = pg_catalog, public
AS $$
DECLARE
  raw_setting text;
  claims      text;
BEGIN
  raw_setting := current_setting('app.organization_id', true);
  IF raw_setting IS NOT NULL AND raw_setting <> '' THEN
    RETURN raw_setting::uuid;
  END IF;

  claims := current_setting('request.jwt.claims', true);
  IF claims IS NOT NULL AND claims <> '' THEN
    RETURN (claims::jsonb ->> 'org_id')::uuid;
  END IF;

  RETURN NULL;
EXCEPTION
  -- A malformed uuid or unparseable claim must deny access, never grant it. Returning
  -- NULL makes every policy below evaluate false.
  WHEN others THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION app_current_organization_id() IS
  'Organization id for the current session, from app.organization_id or a verified JWT claim. NULL denies all tenant rows.';

-- -----------------------------------------------------------------------------
-- Restricted application role
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mgc_app_restricted') THEN
    -- NOLOGIN: this role is assumed via SET ROLE or granted to a login role that is
    -- created per environment. No password lives in a migration.
    CREATE ROLE mgc_app_restricted NOLOGIN;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO mgc_app_restricted;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mgc_app_restricted;
GRANT EXECUTE ON FUNCTION app_current_organization_id() TO mgc_app_restricted;

-- Tables created by later migrations inherit the same grants, so a new model is not
-- silently unreachable — or silently ungoverned — for this role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mgc_app_restricted;

-- -----------------------------------------------------------------------------
-- Policies
--
-- One helper applies the same policy shape to every tenant table, so a table cannot
-- end up with a subtly different rule. USING governs which rows are visible to
-- SELECT/UPDATE/DELETE; WITH CHECK governs what INSERT/UPDATE may write — both are
-- required, since USING alone would let a session insert a row belonging to another
-- organization even though it could never read it back.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_apply_tenant_rls(target_table text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target_table);
  EXECUTE format($p$
    CREATE POLICY tenant_isolation ON %I
      FOR ALL
      TO mgc_app_restricted
      USING (organization_id = app_current_organization_id())
      WITH CHECK (organization_id = app_current_organization_id())
  $p$, target_table);
END;
$$;

SELECT app_apply_tenant_rls('branches');
SELECT app_apply_tenant_rls('organization_members');
SELECT app_apply_tenant_rls('roles');
SELECT app_apply_tenant_rls('role_permissions');
SELECT app_apply_tenant_rls('consent_records');
SELECT app_apply_tenant_rls('audit_logs');

-- Organizations are scoped by their own primary key rather than an organization_id
-- column, so the policy is written out rather than generated.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON organizations;
CREATE POLICY tenant_isolation ON organizations
  FOR ALL
  TO mgc_app_restricted
  USING (id = app_current_organization_id())
  WITH CHECK (id = app_current_organization_id());

-- Audit rows are append-only. Enforced in the database as well as in the extension:
-- an audit trail that the application can rewrite is not evidence of anything.
DROP POLICY IF EXISTS audit_append_only ON audit_logs;
REVOKE UPDATE, DELETE ON audit_logs FROM mgc_app_restricted;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE UPDATE, DELETE ON TABLES FROM mgc_app_restricted;
-- Re-grant on everything except the audit table, since the blanket default above was
-- just narrowed for future tables.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> 'audit_logs'
  LOOP
    EXECUTE format('GRANT UPDATE, DELETE ON %I TO mgc_app_restricted', t);
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- User-owned tables
--
-- Sessions, devices and passkeys belong to a person, not an organization, so tenant
-- policies do not apply. They are keyed to the acting user instead.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  raw_setting text;
  claims      text;
BEGIN
  raw_setting := current_setting('app.user_id', true);
  IF raw_setting IS NOT NULL AND raw_setting <> '' THEN
    RETURN raw_setting::uuid;
  END IF;

  claims := current_setting('request.jwt.claims', true);
  IF claims IS NOT NULL AND claims <> '' THEN
    RETURN (claims::jsonb ->> 'sub')::uuid;
  END IF;

  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION app_current_user_id() TO mgc_app_restricted;

CREATE OR REPLACE FUNCTION app_apply_user_rls(target_table text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
  EXECUTE format('DROP POLICY IF EXISTS user_isolation ON %I', target_table);
  EXECUTE format($p$
    CREATE POLICY user_isolation ON %I
      FOR ALL
      TO mgc_app_restricted
      USING (user_id = app_current_user_id())
      WITH CHECK (user_id = app_current_user_id())
  $p$, target_table);
END;
$$;

SELECT app_apply_user_rls('sessions');
SELECT app_apply_user_rls('devices');
SELECT app_apply_user_rls('webauthn_credentials');

-- A person may only read their own row.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_isolation ON users;
CREATE POLICY user_isolation ON users
  FOR ALL
  TO mgc_app_restricted
  USING (id = app_current_user_id())
  WITH CHECK (id = app_current_user_id());

-- The permission catalogue is global application metadata: readable by everyone,
-- writable by no one but the owner (migrations).
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permissions_readable ON permissions;
CREATE POLICY permissions_readable ON permissions
  FOR SELECT
  TO mgc_app_restricted
  USING (true);
REVOKE INSERT, UPDATE, DELETE ON permissions FROM mgc_app_restricted;
