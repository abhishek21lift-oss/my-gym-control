import { Prisma, type PrismaClient } from '../generated/client/client';

/**
 * Derives, from the Prisma schema itself, which models the tenancy extension must
 * guard and how.
 *
 * Read from the client's runtime datamodel rather than maintained as a hand-written
 * list. A hand-written list is wrong the moment someone adds a model and forgets to
 * update it — and the failure mode of forgetting is an unscoped table, the single worst
 * bug this system can have. Deriving it means a new model with an `organizationId`
 * column is protected the instant it exists.
 *
 * ## On depending on a private field
 *
 * Prisma 7 removed the public `Prisma.dmmf` export; the equivalent information now
 * lives on `client._runtimeDataModel`, which is internal. Depending on an internal for
 * a security control is normally indefensible, so it is done here under one condition:
 * the shape is *validated at construction*, and anything unexpected throws immediately.
 *
 * That converts the risk from "a Prisma upgrade silently disables tenant filtering" into
 * "the process refuses to start". A loud failure at boot, while the previous release is
 * still serving traffic, is an acceptable dependency. A silent one would not be.
 */

/**
 * Models exempt from tenant scoping, each with a reason.
 *
 * The only hand-maintained part, deliberately: adding a model here is an explicit,
 * reviewable decision to opt out of tenant isolation, rather than something that can
 * happen by omission.
 */
export const TENANCY_EXEMPT_MODELS = {
  /**
   * The tenant root. It has no `organizationId` — its own `id` *is* the tenant. Access
   * goes through OrganizationService, which checks membership explicitly.
   */
  Organization: 'tenant root; scoped by its own id',

  /**
   * Global application metadata, not customer data. `members.create` means the same
   * thing for every gym; tenant-scoping it would mean ~200 duplicate rows per signup
   * and migrating all of them on every feature.
   */
  Permission: 'global permission catalogue; application metadata',

  /**
   * A person is one person across gyms — a trainer may work at two. The tenant
   * boundary sits on OrganizationMember instead.
   */
  User: 'global identity; tenancy lives on OrganizationMember',

  /** Belong to a User, not an organization. Guarded by userId ownership checks. */
  Session: 'user-owned; guarded by userId',
  Device: 'user-owned; guarded by userId',
  WebAuthnCredential: 'user-owned; guarded by userId',

  /**
   * Written *by* the extension. Scoping its reads through the same extension would
   * recurse; audit reads go through AuditService, which scopes explicitly.
   */
  AuditLog: 'written by the extension itself; would recurse',
} as const satisfies Record<string, string>;

/**
 * Models exempt from soft delete — rows that must be permanently removable.
 *
 * Soft-deleting these would be actively harmful. A revoked session that still exists as
 * a row invites a bug that resurrects it, and "delete my device" must actually mean
 * gone. Audit and consent rows are append-only, so they are never deleted at all.
 */
export const SOFT_DELETE_EXEMPT_MODELS: ReadonlySet<string> = new Set([
  'AuditLog',
  'Session',
  'Device',
  'WebAuthnCredential',
  'Permission',
  'RolePermission',
  'ConsentRecord',
]);

export interface ModelShape {
  readonly tenantScoped: boolean;
  readonly softDeletable: boolean;
  readonly hasBranchId: boolean;
  readonly hasCreatedBy: boolean;
  readonly hasUpdatedBy: boolean;
  readonly auditable: boolean;
}

export interface ModelRegistry {
  get(model: string | undefined): ModelShape | undefined;
  /** Model names the extension will scope. Used by the isolation test suite. */
  tenantScopedModels(): readonly string[];
  /** Models carrying an organizationId that were nonetheless exempted. */
  exemptWithOrganizationId(): readonly string[];
  /** Exemptions naming a model that no longer exists — protection that grants none. */
  staleExemptions(): readonly string[];
}

/** The minimum shape this module needs from Prisma's internal datamodel. */
interface RuntimeDataModel {
  models: Record<string, { fields: Array<{ name: string }> }>;
}

export class PrismaInternalsShapeError extends Error {
  constructor(detail: string) {
    super(
      `Cannot read Prisma's runtime datamodel: ${detail}. The tenancy extension ` +
        'derives tenant-scoped models from it, so it refuses to start rather than run ' +
        'with tenant filtering silently disabled. This almost certainly means a Prisma ' +
        'upgrade changed the client internals — see ' +
        'packages/db/src/extensions/model-metadata.ts.',
    );
    this.name = 'PrismaInternalsShapeError';
  }
}

function readRuntimeDataModel(client: PrismaClient): RuntimeDataModel {
  const candidate = (client as unknown as { _runtimeDataModel?: unknown })._runtimeDataModel;

  if (!candidate || typeof candidate !== 'object') {
    throw new PrismaInternalsShapeError('_runtimeDataModel is missing or not an object');
  }

  const models = (candidate as { models?: unknown }).models;
  if (!models || typeof models !== 'object') {
    throw new PrismaInternalsShapeError('_runtimeDataModel.models is missing');
  }

  const entries = Object.entries(models as Record<string, unknown>);
  if (entries.length === 0) {
    throw new PrismaInternalsShapeError('_runtimeDataModel.models is empty');
  }

  for (const [name, model] of entries) {
    const fields = (model as { fields?: unknown }).fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      throw new PrismaInternalsShapeError(`model "${name}" exposes no field list`);
    }
    if (typeof (fields[0] as { name?: unknown })?.name !== 'string') {
      throw new PrismaInternalsShapeError(`model "${name}" fields lack a string \`name\``);
    }
  }

  /**
   * Cross-check against the *public* ModelName enum. If the internal datamodel ever
   * stops listing a model that the generated client knows about, the registry would
   * quietly return `undefined` for it — and `undefined` means "not tenant-scoped",
   * i.e. unfiltered. That is the exact silent failure this guard exists to prevent.
   */
  const declared = Object.values(Prisma.ModelName) as string[];
  const present = new Set(entries.map(([name]) => name));
  const missing = declared.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new PrismaInternalsShapeError(
      `models absent from the runtime datamodel: ${missing.join(', ')}`,
    );
  }

  return candidate as RuntimeDataModel;
}

/**
 * Builds the registry for a client, validating Prisma's internals in the process.
 *
 * Throws `PrismaInternalsShapeError` rather than degrading. See the note at the top of
 * this file for why failing closed is the right behaviour here.
 */
export function createModelRegistry(client: PrismaClient): ModelRegistry {
  const datamodel = readRuntimeDataModel(client);
  const shapes = new Map<string, ModelShape>();
  const tenantScoped: string[] = [];
  const exemptWithOrgId: string[] = [];

  for (const [name, model] of Object.entries(datamodel.models)) {
    const fields = new Set(model.fields.map((field) => field.name));
    const exempt = name in TENANCY_EXEMPT_MODELS;
    const hasOrganizationId = fields.has('organizationId');
    const isTenantScoped = hasOrganizationId && !exempt;

    shapes.set(name, {
      tenantScoped: isTenantScoped,
      softDeletable: fields.has('deletedAt') && !SOFT_DELETE_EXEMPT_MODELS.has(name),
      hasBranchId: fields.has('branchId'),
      hasCreatedBy: fields.has('createdBy'),
      hasUpdatedBy: fields.has('updatedBy'),
      // Audit rows themselves are never audited, for the obvious reason.
      auditable: name !== 'AuditLog',
    });

    if (isTenantScoped) tenantScoped.push(name);
    else if (hasOrganizationId) exemptWithOrgId.push(name);
  }

  const modelNames = new Set(Object.keys(datamodel.models));
  const stale = Object.keys(TENANCY_EXEMPT_MODELS).filter((name) => !modelNames.has(name));

  return {
    get: (model) => (model === undefined ? undefined : shapes.get(model)),
    tenantScopedModels: () => tenantScoped,
    exemptWithOrganizationId: () => exemptWithOrgId,
    staleExemptions: () => stale,
  };
}
