import { describe, expect, it, vi } from 'vitest'

import { normalizeOptions, parseHttpUrl, withTimeout } from './runtime.mts'
import type { EmbedResolverOptions } from './types.mts'

const dispatcher = {} as NonNullable<RequestInit['dispatcher']>

describe('resolver runtime configuration', () => {
  it('accepts explicit limits and providers', () => {
    const provider = { key: 'custom', match: () => null }
    const result = normalizeOptions({
      ...options(),
      providers: [provider],
      maxRedirects: 0,
      maxDocumentSizeBytes: 1,
      maxOEmbedSizeBytes: 2,
      timeoutMs: 3,
    })
    expect(result).toMatchObject({
      providers: [provider],
      maxRedirects: 0,
      maxDocumentSizeBytes: 1,
      maxOEmbedSizeBytes: 2,
      timeoutMs: 3,
    })
  })

  it.each([
    [{ userAgent: ' ' }, 'userAgent'],
    [{ maxDocumentSizeBytes: 0 }, 'positive'],
    [{ maxOEmbedSizeBytes: 1.5 }, 'positive'],
    [{ timeoutMs: Number.MAX_SAFE_INTEGER + 1 }, 'positive'],
    [{ maxRedirects: -1 }, 'non-negative'],
    [{ maxRedirects: 1.5 }, 'non-negative'],
  ] as const)('rejects invalid option %o', (overrides, message) => {
    expect(() => normalizeOptions({ ...options(), ...overrides })).toThrow(message)
  })

  it('parses URL objects and rejects unsafe URL forms', () => {
    expect(parseHttpUrl(new URL('https://example.com')).href).toBe('https://example.com/')
    expect(() => parseHttpUrl('file:///tmp/example')).toThrow('HTTP or HTTPS')
    expect(() => parseHttpUrl('https://user@example.com')).toThrow('credentials')
    expect(() => parseHttpUrl('https://:secret@example.com')).toThrow('credentials')
  })

  it('combines a caller signal with the timeout signal', async () => {
    const controller = new AbortController()
    await withTimeout(100, { signal: controller.signal }, async (signal) => {
      expect(signal).not.toBe(controller.signal)
      controller.abort()
      expect(signal.aborted).toBe(true)
    })
  })
})

function options(): EmbedResolverOptions {
  return {
    fetch: vi.fn(),
    resolveDestination: vi.fn().mockReturnValue({ dispatcher }),
    authorizeUrl: vi.fn().mockResolvedValue(true),
    userAgent: 'runtime-test/1.0',
  }
}
