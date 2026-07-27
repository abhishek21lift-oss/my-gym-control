import { z } from 'zod';

/**
 * Cursor pagination, not offset.
 *
 * `OFFSET n` makes the database scan and discard n rows, so page 500 of a member list
 * is measurably slower than page 1, and rows shift under the reader when a record is
 * inserted mid-pagination. Gyms accumulate rows permanently — attendance and workout
 * sets grow without bound — so the degradation is guaranteed rather than hypothetical.
 *
 * The cursor is an opaque, ordered key (UUID v7 primary key). Clients must treat it as
 * opaque; the encoding is free to change.
 */
export const cursorPaginationSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  direction: z.enum(['forward', 'backward']).default('forward'),
});
export type CursorPagination = z.infer<typeof cursorPaginationSchema>;

export const sortDirectionSchema = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof sortDirectionSchema>;

/** Builds the response envelope schema for a paginated list of `item`. */
export function paginatedResponseSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      hasPreviousPage: z.boolean(),
      startCursor: z.string().nullable(),
      endCursor: z.string().nullable(),
    }),
    /**
     * Deliberately optional. An exact `COUNT(*)` over a large, filtered, tenant-scoped
     * table is often more expensive than the page query itself, so it is only computed
     * when the caller explicitly asks for it.
     */
    totalCount: z.number().int().nonnegative().optional(),
  });
}

export type PaginatedResponse<T> = {
  data: T[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  totalCount?: number;
};
