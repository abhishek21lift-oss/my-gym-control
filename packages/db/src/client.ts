import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client/client';

export type DatabaseClient = PrismaClient;

export interface CreateClientOptions {
  databaseUrl: string;
  /** Emits query timings to the logger. Off by default — it is very noisy. */
  logQueries?: boolean;
  /**
   * Upper bound on pooled connections held by this process.
   *
   * Sized against the database's own limit divided by the number of running
   * instances — not "as high as possible". Supabase's pooler and Postgres both cap
   * total connections, and an API that opens more than its share starves the worker
   * process and the migration job of the connections they need.
   */
  maxConnections?: number;
}

/**
 * Constructs the base Prisma client.
 *
 * Prisma 7 removed the bundled Rust query engine, so a driver adapter is now required
 * rather than optional. `PrismaPg` runs queries through node-postgres, which also means
 * pool behaviour is configured here in application code instead of through connection
 * string parameters.
 *
 * Deliberately un-extended: the tenancy, soft-delete and audit extensions are applied
 * in Phase 1 by `withTenancy()`, and this un-extended client is what migrations, the
 * seed script and genuine cross-tenant platform operations use. Keeping the two
 * separate makes "this code bypasses tenant isolation" a visible, greppable choice
 * rather than an accident.
 */
export function createPrismaClient(options: CreateClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.databaseUrl,
    max: options.maxConnections ?? 10,
    // Fail fast rather than queueing behind an exhausted pool: a request that waits
    // 30 seconds for a connection has already failed from the user's point of view.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  return new PrismaClient({
    adapter,
    log: options.logQueries
      ? ['query', 'warn', 'error']
      : ['warn', 'error'],
  });
}

/**
 * Verifies the connection is live and the server is answering queries.
 *
 * `SELECT 1` rather than Prisma's `$connect()`: connecting proves a socket opened,
 * which is not the same as the database being able to serve a query. Readiness probes
 * need the stronger claim.
 */
export async function pingDatabase(client: PrismaClient): Promise<void> {
  await client.$queryRaw`SELECT 1`;
}
