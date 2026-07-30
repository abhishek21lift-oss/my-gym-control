import { AsyncLocalStorage } from 'node:async_hooks';
import type { PrismaClient } from '../generated/client/client';
import { getTenantContext, requireTenantContext } from '../tenant-context';
import { createModelRegistry } from './model-metadata';
import { redactForAudit } from './redaction';

/**
 * The tenancy, soft-delete and audit extension.
 *
 * This is the load-bearing security control of the entire platform (see
 * docs/ARCHITECTURE.md §4). Its purpose is to make cross-tenant data access
 * *inexpressible* rather than merely discouraged.
 *
 * The alternative — requiring every service to remember `where: { organizationId }` —
 * fails for a well-understood reason: it works perfectly until the one query that
 * forgets, and that query looks completely normal in review. There is no amount of
 * discipline that makes a thousand hand-written filters reliable. So services never
 * write the filter at all; it is injected here, for every model that has an
 * `organizationId` column, derived from the schema rather than from a list someone
 * maintains.
 *
 * Four things happen on every query:
 *
 *   1. Reads are filtered to the active organization and to non-deleted rows.
 *   2. Writes are stamped with organization, branch and actor.
 *   3. Deletes are rewritten as soft deletes.
 *   4. Mutations are recorded in the append-only audit log.
 */

// -----------------------------------------------------------------------------
// Escape hatches
//
// Both are deliberately awkward to reach and impossible to trigger by accident. A
// bypass that is convenient is a bypass that gets used casually.
// -----------------------------------------------------------------------------

const softDeleteVisibility = new AsyncLocalStorage<'include'>();

/**
 * Runs `fn` with soft-deleted rows visible to reads.
 *
 * For restore flows and administrative recovery — "show me what reception deleted this
 * morning". Scoped to a callback rather than exposed as a client flag so it cannot leak
 * into surrounding code.
 */
export function includingSoftDeleted<T>(fn: () => T): T {
  return softDeleteVisibility.run('include', fn);
}

const tenancyBypass = new AsyncLocalStorage<{ reason: string }>();

/**
 * Runs `fn` with tenant filtering disabled.
 *
 * Required for genuinely cross-tenant work: platform administration, scheduled billing
 * across all organizations, aggregate telemetry. It demands a written reason, which is
 * recorded on every audit row produced inside it — so an unexplained bypass cannot be
 * introduced quietly, and a grep for this function lists every place isolation is
 * intentionally suspended.
 */
export function bypassingTenancy<T>(reason: string, fn: () => T): T {
  if (!reason.trim()) {
    throw new Error('bypassingTenancy() requires a non-empty reason');
  }
  return tenancyBypass.run({ reason }, fn);
}

const isBypassed = (): boolean => tenancyBypass.getStore() !== undefined;

// -----------------------------------------------------------------------------
// Operation classification
// -----------------------------------------------------------------------------

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** findUnique rejects non-unique fields in `where`, so it is rewritten to findFirst. */
const UNIQUE_TO_FIRST: Record<string, string> = {
  findUnique: 'findFirst',
  findUniqueOrThrow: 'findFirstOrThrow',
};

const SINGLE_ROW_MUTATIONS = new Set(['update', 'delete', 'upsert']);
const BULK_MUTATIONS = new Set(['updateMany', 'deleteMany']);
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

type Args = Record<string, unknown>;

/** Merges tenant predicates into a `where` clause without clobbering the caller's. */
function scopeWhere(
  existing: unknown,
  organizationId: string,
  excludeDeleted: boolean,
): Args {
  const where: Args = { ...((existing as Args | undefined) ?? {}) };
  where['organizationId'] = organizationId;
  if (excludeDeleted) {
    where['deletedAt'] = null;
  }
  return where;
}

function delegateFor(client: PrismaClient, model: string | undefined): Record<string, Function> {
  if (model === undefined) {
    // Unreachable: only tenant-scoped models reach this helper, and those always have
    // a name. Guarded anyway so a future refactor cannot turn it into a silent no-op.
    throw new Error('delegateFor() called without a model name');
  }
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  // The delegate map is not expressible in Prisma's generated types when the model name
  // is only known at runtime; the cast is contained to this one helper.
  const delegate = (client as unknown as Record<string, Record<string, Function>>)[key];
  if (!delegate) throw new Error(`No Prisma delegate for model "${model}"`);
  return delegate;
}

// -----------------------------------------------------------------------------
// Extension
// -----------------------------------------------------------------------------

export interface TenancyOptions {
  /**
   * Whether a failed audit write should fail the mutation that triggered it.
   *
   * Defaults to true — fail closed. A platform that advertises audit logging must not
   * quietly accept unlogged writes, and "the audit table was unavailable" is not an
   * acceptable explanation for a missing entry during an investigation. The cost is
   * that audit-table availability becomes a hard dependency for writes, which is the
   * correct trade for financial and health records but is exposed here so a deployment
   * with different obligations can choose otherwise.
   */
  readonly failClosedOnAuditError?: boolean;
  /** Invoked when an audit write fails, whether or not the mutation is failed. */
  readonly onAuditError?: (error: unknown) => void;
}

export function withTenancy(base: PrismaClient, options: TenancyOptions = {}) {
  const failClosed = options.failClosedOnAuditError ?? true;

  // Built once, at construction. Validates Prisma's internal datamodel and throws if
  // it cannot be read — see model-metadata.ts on why this fails closed.
  const registry = createModelRegistry(base);

  /**
   * Writes an audit row using the *unextended* client.
   *
   * Using the extended client here would re-enter this extension and recurse. It also
   * means the audit insert is outside the mutation's transaction, which is why the
   * fail-closed decision above matters.
   */
  async function writeAudit(entry: {
    organizationId: string;
    branchId: string | null;
    actorId: string | null;
    action: string;
    entity: string;
    entityId: string | null;
    before: unknown;
    after: unknown;
  }): Promise<void> {
    try {
      await base.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          branchId: entry.branchId,
          actorId: entry.actorId,
          actorType: entry.actorId ? 'USER' : 'SYSTEM',
          action: entry.action as never,
          entity: entry.entity,
          entityId: entry.entityId,
          before: (redactForAudit(entry.entity, entry.before) ?? null) as never,
          after: (redactForAudit(entry.entity, entry.after) ?? null) as never,
        },
      });
    } catch (error) {
      options.onAuditError?.(error);
      if (failClosed) throw error;
    }
  }

  return base.$extends({
    name: 'mgc-tenancy',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const shape = registry.get(model);

          // Models with no organizationId column, or explicitly exempted ones, pass
          // through untouched. Their access control lives in their own services.
          if (!shape?.tenantScoped || isBypassed()) {
            return query(args);
          }

          const { organizationId, branchId, userId } = requireTenantContext();
          const excludeDeleted =
            shape.softDeletable && softDeleteVisibility.getStore() !== 'include';
          const mutableArgs = (args ?? {}) as Args;

          // ---- Reads --------------------------------------------------------
          if (READ_OPERATIONS.has(operation)) {
            const scoped: Args = {
              ...mutableArgs,
              where: scopeWhere(mutableArgs['where'], organizationId, excludeDeleted),
            };

            const rewritten = UNIQUE_TO_FIRST[operation];
            if (rewritten) {
              // Bypassing `query()` because the operation itself is changing. This
              // re-enters the extension, but the model/args are already scoped and
              // the second pass is idempotent.
              return delegateFor(base, model)[rewritten]!(scoped);
            }
            return query(scoped);
          }

          // ---- Creates ------------------------------------------------------
          if (CREATE_OPERATIONS.has(operation)) {
            const stamp = (row: unknown): Args => {
              const data: Args = { ...((row as Args | undefined) ?? {}) };
              data['organizationId'] = organizationId;
              if (shape.hasBranchId && data['branchId'] === undefined && branchId !== null) {
                data['branchId'] = branchId;
              }
              if (shape.hasCreatedBy && data['createdBy'] === undefined) {
                data['createdBy'] = userId;
              }
              return data;
            };

            const incoming = mutableArgs['data'];
            const scoped: Args = {
              ...mutableArgs,
              data: Array.isArray(incoming) ? incoming.map(stamp) : stamp(incoming),
            };

            const result = await query(scoped);

            if (shape.auditable && !Array.isArray(incoming)) {
              const created = result as { id?: string } | null;
              await writeAudit({
                organizationId,
                branchId,
                actorId: userId,
                action: 'CREATE',
                entity: model,
                entityId: created?.id ?? null,
                before: null,
                after: result,
              });
            }
            return result;
          }

          // ---- Single-row mutations ----------------------------------------
          if (SINGLE_ROW_MUTATIONS.has(operation)) {
            const scopedWhere = scopeWhere(mutableArgs['where'], organizationId, excludeDeleted);

            // Snapshot the prior state for the audit trail. Costs one extra read per
            // mutation, which is the price of a usable before/after history; the
            // alternative is an audit log that records that something changed without
            // recording what it was.
            const before = shape.auditable
              ? await delegateFor(base, model)['findFirst']!({ where: scopedWhere })
              : null;

            // Soft delete: rewrite `delete` as an update rather than issuing DELETE.
            if (operation === 'delete' && shape.softDeletable) {
              const data: Args = { deletedAt: new Date() };
              if (shape.hasUpdatedBy) data['updatedBy'] = userId;

              const result = await delegateFor(base, model)['update']!({
                where: scopedWhere,
                data,
              });

              if (shape.auditable) {
                await writeAudit({
                  organizationId,
                  branchId,
                  actorId: userId,
                  action: 'DELETE',
                  entity: model,
                  entityId: (before as { id?: string } | null)?.id ?? null,
                  before,
                  after: null,
                });
              }
              return result;
            }

            const scoped: Args = { ...mutableArgs, where: scopedWhere };

            if (operation === 'upsert') {
              const create: Args = { ...((mutableArgs['create'] as Args) ?? {}) };
              create['organizationId'] = organizationId;
              if (shape.hasCreatedBy && create['createdBy'] === undefined) {
                create['createdBy'] = userId;
              }
              scoped['create'] = create;
            }

            if (shape.hasUpdatedBy) {
              const target = operation === 'upsert' ? 'update' : 'data';
              const data: Args = { ...((mutableArgs[target] as Args) ?? {}) };
              data['updatedBy'] = userId;
              scoped[target] = data;
            }

            const result = await query(scoped);

            if (shape.auditable) {
              await writeAudit({
                organizationId,
                branchId,
                actorId: userId,
                action: before ? 'UPDATE' : 'CREATE',
                entity: model,
                entityId: (result as { id?: string } | null)?.id ?? null,
                before,
                after: result,
              });
            }
            return result;
          }

          // ---- Bulk mutations ----------------------------------------------
          if (BULK_MUTATIONS.has(operation)) {
            const scopedWhere = scopeWhere(mutableArgs['where'], organizationId, excludeDeleted);

            const finish = async (result: unknown, action: string): Promise<unknown> => {
              if (shape.auditable) {
                await writeAudit({
                  organizationId,
                  branchId,
                  actorId: userId,
                  action,
                  entity: model,
                  // No single entity, and snapshotting every affected row would make an
                  // unbounded bulk update unboundedly expensive. The predicate plus the
                  // affected count is the honest, bounded record.
                  entityId: null,
                  before: { where: scopedWhere },
                  after: result,
                });
              }
              return result;
            };

            if (operation === 'deleteMany' && shape.softDeletable) {
              const data: Args = { deletedAt: new Date() };
              if (shape.hasUpdatedBy) data['updatedBy'] = userId;
              const result = await delegateFor(base, model)['updateMany']!({
                where: scopedWhere,
                data,
              });
              return finish(result, 'DELETE');
            }

            const scoped: Args = { ...mutableArgs, where: scopedWhere };
            if (shape.hasUpdatedBy && operation === 'updateMany') {
              const data: Args = { ...((mutableArgs['data'] as Args) ?? {}) };
              data['updatedBy'] = userId;
              scoped['data'] = data;
            }
            return finish(await query(scoped), 'UPDATE');
          }

          /**
           * An operation this extension does not recognise — a new Prisma verb, or a
           * raw call routed through a model delegate.
           *
           * Refused rather than passed through. Passing it through would silently
           * execute an unscoped query against tenant data, which is precisely the
           * failure this extension exists to prevent. Failing loudly turns a future
           * Prisma upgrade into a test failure instead of a data leak.
           */
          throw new Error(
            `Unhandled operation "${operation}" on tenant-scoped model "${model}". ` +
              'The tenancy extension refuses to pass through operations it cannot ' +
              'scope. Add explicit handling in packages/db/src/extensions/tenancy.ts.',
          );
        },
      },
    },
  });
}

export type TenantAwareClient = ReturnType<typeof withTenancy>;

/** Re-exported so callers can check for a context without importing two modules. */
export { getTenantContext };

/** Guards against a Prisma upgrade adding operations the extension does not know. */
export function knownOperations(): readonly string[] {
  return [...READ_OPERATIONS, ...CREATE_OPERATIONS, ...SINGLE_ROW_MUTATIONS, ...BULK_MUTATIONS];
}
