import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

loadDotenv({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    /**
     * Serial, single-fork. The isolation suite asserts exact row counts for its two
     * organizations; running files in parallel against one database would let them see
     * each other's fixtures and produce failures that look like isolation bugs but are
     * test-harness artefacts.
     */
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // A real database, real migrations and two tenants take longer to set up than a
    // unit test's default budget allows.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
