import { describe, expect, it } from 'vitest'
import { getCrawlDelayMs, isUrlAllowed, type RobotsCache, type RobotsTransport } from './index.mts'

function transport(body: string, status = 200): RobotsTransport {
  return { fetch: async () => new Response(body, { status }) }
}

describe('robots', () => {
  it('applies allow/disallow and crawl delay rules', async () => {
    const options = {
      transport: transport('User-agent: bot\nDisallow: /private\nCrawl-delay: 1.5'),
    }
    await expect(isUrlAllowed('https://example.test/public', 'bot', options)).resolves.toBe(true)
    await expect(isUrlAllowed('https://example.test/private', 'bot', options)).resolves.toBe(false)
    await expect(getCrawlDelayMs('https://example.test/', 'bot', options)).resolves.toBe(1500)
    await expect(getCrawlDelayMs('https://example.test/', 'other', options)).resolves.toBeNull()
    await expect(isUrlAllowed('https://example.test/', 'other', options)).resolves.toBe(true)
  })

  it('uses caller cache and fails open on unavailable or oversized files', async () => {
    const calls: string[] = []
    const cache: RobotsCache = {
      get: async (key) => {
        calls.push(`get:${key}`)
        return 'User-agent: *\nDisallow: /'
      },
      set: async () => {
        throw new Error('not used')
      },
    }
    await expect(
      isUrlAllowed('https://example.test/', 'bot', { transport: transport(''), cache }),
    ).resolves.toBe(false)
    expect(calls).toHaveLength(1)
    await expect(
      isUrlAllowed('https://example.test/', 'bot', { transport: transport('', 404) }),
    ).resolves.toBe(true)
    await expect(
      isUrlAllowed('https://example.test/', 'bot', {
        transport: transport('abcdef'),
        maxResponseSizeBytes: 1,
      }),
    ).resolves.toBe(true)
  })

  it('writes cache and rejects invalid limits', async () => {
    const writes: unknown[] = []
    const cache: RobotsCache = {
      get: async () => undefined,
      set: async (...args) => {
        writes.push(args)
      },
    }
    await isUrlAllowed('https://example.test/', 'bot', {
      transport: transport('User-agent: *\nAllow: /'),
      cache,
      ttlMs: 1,
    })
    expect(writes).toHaveLength(1)
    await isUrlAllowed('https://example.test/', 'bot', {
      transport: transport('User-agent: *\nAllow: /'),
      cache,
    })
    expect(writes).toHaveLength(2)
    await expect(
      isUrlAllowed('https://example.test/', 'bot', {
        transport: transport(''),
        maxResponseSizeBytes: 0,
      }),
    ).rejects.toThrow('maxResponse')
  })
})
