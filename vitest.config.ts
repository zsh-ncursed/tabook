import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Run test files sequentially: parallel vitest forks crash on
    // Node 20 with "Worker exited unexpectedly" (16/18 files pass
    // then workers die). Verified: --no-file-parallelism is green
    // on Node 20 (144/144). Suite is ~4s, so no perf cost.
    fileParallelism: false,
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
