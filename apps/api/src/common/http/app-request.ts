import type { Request } from 'express';

/**
 * An Express request after our middleware chain has run.
 *
 * Modelled as an explicit interface rather than a `declare module` augmentation of
 * Express's own `Request`. Two reasons:
 *
 *  1. Under pnpm's isolated node_modules, `express-serve-static-core` is a transitive
 *     type package and is not reliably resolvable from the augmenting file — the
 *     augmentation silently fails to apply rather than erroring.
 *  2. Globally widening `Request` tells every handler in the codebase that `requestId`
 *     is always present, including handlers that run before the middleware sets it.
 *     Naming the enriched type makes the guarantee explicit at each use site.
 *
 * Extend this interface as later phases attach more per-request state (the
 * authenticated user and tenant context land in Phase 1).
 */
export interface AppRequest extends Request {
  /** Correlation id assigned by RequestIdMiddleware; echoed in the response header. */
  requestId: string;
}
