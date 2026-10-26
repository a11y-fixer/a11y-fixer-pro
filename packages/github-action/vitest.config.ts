import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      // index.ts here is the real action entry point, not a barrel re-export,
      // so it is intentionally not excluded.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', '**/vitest.config.ts'],
      reporter: ['text', 'html'],
      // Branches sit lower by design: the uncovered ones are defensive type
      // guards, input-default fallbacks, and the uncoverable VITEST entry guard.
      thresholds: { lines: 90, functions: 90, branches: 70, statements: 90 },
    },
  },
});
