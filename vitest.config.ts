import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
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
        'src/opds/fixtures/**',
        'src/opds/client.test-utils.ts',
      ],
      // Coverage dropped with the rust-native migration: parsing, layout and
      // search now live in crates/tabook-native, where the equivalent coverage
      // is provided by `cargo test` (see AGENTS.md). The remaining TS is the
      // native delegation + pure-TS fallback (exercised when the .node binding
      // is absent, e.g. on non-Linux hosts). Thresholds below reflect that.
      thresholds: {
        lines: 82,
        functions: 78,
        statements: 80,
        branches: 74,
      },
    },
  },
});
