import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantContext } from '@mgc/contracts';

/**
 * Ambient tenant context for the current request or job.
 *
 * This is the mechanism that makes tenant isolation structural rather than
 * disciplinary. A NestJS middleware establishes the context once per request; the
 * Prisma client extension reads it on every query. Between those two points, no
 * service, repository or controller ever handles `organizationId` — which is exactly
 * why none of them can forget it.
 *
 * AsyncLocalStorage rather than a request-scoped DI provider because the context must
 * survive into BullMQ job handlers, Prisma middleware and any `await` boundary, none
 * of which have access to Nest's request scope.
 */
const storage = new AsyncLocalStorage<TenantContext>();

/** Runs `fn` with `context` visible to everything it awaits, transitively. */
export function runWithTenantContext<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The active context, or `undefined` outside any tenant-scoped operation. */
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * The active context, or a thrown error.
 *
 * Used by the Prisma extension on tenant-scoped models. Failing loudly is the correct
 * behaviour: a query against tenant data with no tenant established is either a bug or
 * an attempt to read across the boundary, and silently returning every organization's
 * rows would be the worst possible outcome.
 */
export function requireTenantContext(): TenantContext {
  const context = storage.getStore();
  if (!context) {
    throw new MissingTenantContextError();
  }
  return context;
}

export class MissingTenantContextError extends Error {
  constructor() {
    super(
      'No tenant context is active. Tenant-scoped database access must run inside ' +
        'runWithTenantContext(). If this is a genuinely cross-tenant operation ' +
        '(platform administration, a scheduled job), use the explicitly named ' +
        'system client instead.',
    );
    this.name = 'MissingTenantContextError';
  }
}
