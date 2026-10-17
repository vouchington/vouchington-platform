import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@vouchington/localization': fileURLToPath(
        new URL('./packages/localization/src/index.mts', import.meta.url),
      ),
      '@vouchington/utils/scopes': fileURLToPath(
        new URL('./packages/utils/src/scopes.mts', import.meta.url),
      ),
      '@vouchington/crawler-html': fileURLToPath(
        new URL('./packages/crawler-html/src/index.mts', import.meta.url),
      ),
      '@vouchington/utils/cookies': fileURLToPath(
        new URL('./packages/utils/src/cookies.mts', import.meta.url),
      ),
      '@vouchington/utils/observability': fileURLToPath(
        new URL('./packages/utils/src/observability.mts', import.meta.url),
      ),
      '@vouchington/utils/sentry-envelope': fileURLToPath(
        new URL('./packages/utils/src/sentry-envelope.mts', import.meta.url),
      ),
      '@vouchington/http-transport': fileURLToPath(
        new URL('./packages/http-transport/src/index.mts', import.meta.url),
      ),
    },
  },
  test: {
    fileParallelism: false,
    include: [
      'packages/*/src/**/*.test.mts',
      'packages/ui/src/**/*.test.tsx',
      'test/**/*.test.mts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.mts', 'packages/ui/src/**/*.{ts,tsx}'],
      exclude: [
        'packages/*/src/**/*.test.mts',
        'packages/ui/src/**/*.test.tsx',
        'packages/*/src/**/test-helpers.mts',
        'packages/*/src/**/*-test-helpers.mts',
        'packages/*/src/**/types.mts',
        'packages/*/src/**/*-types.mts',
        'packages/*/src/**/*.d.ts',
        'packages/*/src/bin.mts',
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
