import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Unit tests only. The integration suite needs a live Postgres and runs from
    // vitest.integration.config.ts via `pnpm test:integration`, so that `pnpm test`
    // stays runnable without Docker.
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
  },
});
