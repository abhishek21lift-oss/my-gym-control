import { z } from 'zod';

/**
 * A single, stable error envelope for the whole API.
 *
 * Clients must be able to branch on a machine-readable `code` rather than pattern-match
 * an English `message`. `message` is for humans and may be reworded at any time;
 * `code` is part of the contract and is not changed without a version bump.
 */
export const apiErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYMENT_REQUIRED',
  'PROVIDER_UNAVAILABLE',
  'INTERNAL_ERROR',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const fieldErrorSchema = z.object({
  /** Dot/bracket path into the submitted payload, e.g. `contact.phone` or `items[0].qty`. */
  path: z.string(),
  message: z.string(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string(),
  /** Populated only for VALIDATION_FAILED, so forms can attach errors to inputs. */
  fields: z.array(fieldErrorSchema).optional(),
  /**
   * Correlates the client-visible failure with the server log entry. Support can ask
   * for this id instead of asking the user to reproduce the problem.
   */
  requestId: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * Domain failures that are expected (member already checked in, plan expired) are
 * returned as values rather than thrown, so the type system forces the caller to handle
 * them. Exceptions remain reserved for genuinely exceptional conditions.
 */
export type Result<T, E = ApiError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;
