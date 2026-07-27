import { z } from 'zod';

/**
 * Every primary key in the system is a UUID v7.
 *
 * v7 rather than v4 because v7 is time-ordered: it indexes without page splits under
 * insert-heavy load (check-ins, workout sets, audit rows), and it sorts chronologically
 * without a secondary index on `createdAt`. It keeps the non-enumerability of a random
 * id, which sequential integers do not — exposing `/members/1041` tells a competitor
 * exactly how many members a gym has.
 */
export const uuidSchema = z.uuid({ version: 'v7' });
export type Uuid = z.infer<typeof uuidSchema>;

/** Accepts any UUID version. Used at boundaries with external systems. */
export const anyUuidSchema = z.uuid();

export const organizationIdSchema = uuidSchema.describe('Owning organization');
export const branchIdSchema = uuidSchema.describe('Owning branch');
export const userIdSchema = uuidSchema.describe('Acting user');

/**
 * The tenant context resolved from the authenticated request and carried through
 * AsyncLocalStorage. The Prisma client extension reads this on every query — see
 * docs/ARCHITECTURE.md §4.
 */
export const tenantContextSchema = z.object({
  organizationId: organizationIdSchema,
  /** Null for organization-wide records that are not scoped to a single branch. */
  branchId: branchIdSchema.nullable(),
  userId: userIdSchema,
});
export type TenantContext = z.infer<typeof tenantContextSchema>;

/** ISO-4217. The platform is multi-currency at the schema level from day one. */
export const currencyCodeSchema = z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD']);
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

/**
 * Money is always an integer count of the currency's minor unit (paise for INR,
 * cents for USD). Floating point never touches a monetary value: 0.1 + 0.2 !== 0.3
 * is not an acceptable property for an invoice line.
 */
export const minorAmountSchema = z
  .int()
  .describe('Amount in the currency’s smallest unit (e.g. paise for INR)');

export const moneySchema = z.object({
  amount: minorAmountSchema,
  currency: currencyCodeSchema,
});
export type Money = z.infer<typeof moneySchema>;
