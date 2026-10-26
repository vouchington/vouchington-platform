import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createUnresolvedMessageReporter, seedFromBootstrap } from './index.mts'
import * as react from './react/index.mts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('server-safe unresolved message reporter', () => {
  it('is exported from the root entry, which is not a client module', () => {
    for (const path of ['./index.mts', './reporter.mts']) {
      expect(source(path)).not.toMatch(/^\s*['"]use client['"]/u)
      expect(source(path)).not.toMatch(/from 'react'/u)
    }
    expect(source('./react/index.mts')).toMatch(/^'use client'/u)
  })

  it('reports each key once per locale through the injected capture', () => {
    const capture = vi.fn()
    const en = createUnresolvedMessageReporter('en', capture)
    const es = createUnresolvedMessageReporter('es', capture)
    expect([en('a'), en('a'), en('b'), es('a')]).toEqual(['', '', '', ''])
    expect(capture.mock.calls.map(([error, context]) => [error.message, context])).toEqual([
      [
        'Unresolvable message key "a"',
        {
          tags: { i18n: 'unresolved-message', locale: 'en', key: 'a' },
          fingerprint: ['i18n-unresolved-message', 'en', 'a'],
        },
      ],
      [
        'Unresolvable message key "b"',
        {
          tags: { i18n: 'unresolved-message', locale: 'en', key: 'b' },
          fingerprint: ['i18n-unresolved-message', 'en', 'b'],
        },
      ],
      [
        'Unresolvable message key "a"',
        {
          tags: { i18n: 'unresolved-message', locale: 'es', key: 'a' },
          fingerprint: ['i18n-unresolved-message', 'es', 'a'],
        },
      ],
    ])
  })

  it('is the same function the React subpath re-exports', () => {
    expect(react.createUnresolvedMessageReporter).toBe(createUnresolvedMessageReporter)
    expect(react.seedFromBootstrap).toBe(seedFromBootstrap)
  })
})
