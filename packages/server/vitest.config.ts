// Vitest setup: unit tests are fast; the integration test may download a mongod binary on first run.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 300_000,
  },
});
