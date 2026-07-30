/**
 * Bridges a gap between runtime behaviour and Prisma's generated types.
 *
 * The tenancy extension supplies `organizationId`, `createdBy` and `updatedBy` on every
 * write (see tenancy.ts). Prisma's generated `*CreateInput` types, however, are produced
 * from the schema and still list `organizationId` as required — they have no way to know
 * an extension will fill it in. Left alone, that forces every call site to pass a value
 * that is then immediately overwritten, which is worse than useless: it reads as though
 * the caller controls the tenant, and a reviewer could reasonably believe it does.
 *
 * `tenantData` states the guarantee in the type system instead. It widens the object to
 * declare the injected fields as present, so Prisma's input type is satisfied without
 * anyone writing a tenant id by hand.
 *
 * It is a type-level assertion, not a runtime one — the runtime guarantee is the
 * extension's, and the isolation suite is what verifies it. Nothing here can be used to
 * *change* the tenant: the extension assigns `organizationId` after spreading the
 * caller's data, so a supplied value is always discarded.
 *
 * Application code will rarely touch this. From Phase 2 the repository layer wraps it,
 * so services pass domain DTOs and never see Prisma input types at all — which is the
 * point of the repository pattern in docs/ARCHITECTURE.md §3.
 */

/** The columns the tenancy extension populates on the caller's behalf. */
export interface InjectedTenantFields {
  organizationId: string;
  createdBy: string;
  updatedBy: string;
  branchId: string | null;
}

/**
 * Declares the extension-injected fields as present on a write payload.
 *
 * ```ts
 * // No organizationId, no createdBy — the extension supplies both.
 * await db.branch.create({ data: tenantData({ name: 'Koregaon Park', code: 'KP' }) });
 * ```
 *
 * The return type is a widening, so TypeScript's excess-property check does not fire on
 * models that lack one of these columns.
 */
export function tenantData<T extends object>(data: T): T & InjectedTenantFields {
  return data as T & InjectedTenantFields;
}
