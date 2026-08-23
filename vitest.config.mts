import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['packages/*/src/**/*.test.mts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.mts'],
      exclude: [
        'packages/*/src/**/*.test.mts',
        'packages/*/src/**/test-helpers.mts',
        'packages/*/src/**/types.mts',
        'packages/*/src/**/*-types.mts',
        'packages/*/src/**/*.d.ts',
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
})
