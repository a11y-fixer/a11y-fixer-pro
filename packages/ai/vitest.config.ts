import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', '**/vitest.config.ts'],
      reporter: ['text', 'html'],
      // Branches sit lower by design: the uncovered ones are defensive type
      // guards and input-default fallbacks, not untested logic.
      thresholds: { lines: 90, functions: 90, branches: 70, statements: 90 },
    },
  },
});
