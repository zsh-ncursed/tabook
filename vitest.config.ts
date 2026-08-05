import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Limit parallel worker forks: on CI runners many concurrent
    // vitest workers can crash with "Worker exited unexpectedly".
    // Vitest 4 removed test.poolOptions — limits are top-level now.
    pool: 'forks',
    maxWorkers: 2,
    minWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test-utils.ts',
        'src/formats/test-utils.ts',
        'src/index.ts',
        'src/utils/open.ts',
        'src/cli/**',
        'src/tui/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
