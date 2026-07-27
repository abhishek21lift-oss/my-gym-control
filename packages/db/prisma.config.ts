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
    url: env('DATABASE_URL'),
    /**
     * Migrations require a direct, unpooled connection. Prisma Migrate takes advisory
     * locks and runs DDL in a session that pgbouncer's transaction pooling will break.
     */
    directUrl: env('DIRECT_URL'),
  },
});
