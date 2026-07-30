import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * Connection URLs moved out of schema.prisma in v7 and no longer load from `.env`
 * implicitly, so the root env file is loaded explicitly here. The repository keeps a
 * single `.env` at the workspace root rather than one per package: three copies of
 * DATABASE_URL is three chances for them to disagree.
 */
loadDotenv({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(__dirname, 'prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    /**
     * This URL is used by the Prisma CLI only — migrate, db push, studio — never by the
     * application at runtime, which connects through the `pg` driver adapter in
     * src/client.ts.
     *
     * That split is why `directUrl` no longer exists in Prisma 7: the two connections
     * are now configured in two different places, so there is nothing left to
     * disambiguate. It also means this must be the *direct*, unpooled connection.
     * Prisma Migrate takes session-level advisory locks and runs DDL across statements,
     * both of which pgbouncer's transaction pooling breaks.
     *
     * DIRECT_URL is preferred and DATABASE_URL is the fallback, so local development —
     * where the two are the same — needs no extra configuration, while production is
     * required by the env schema to set DIRECT_URL explicitly.
     */
    url: env('DIRECT_URL') ?? env('DATABASE_URL'),
  },
});
