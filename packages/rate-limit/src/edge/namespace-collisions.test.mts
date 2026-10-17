import { describe, expect, it, vi } from 'vitest'

import { findRateLimitNamespaceCollisions, runRateLimitNamespaceCollisionCli } from './index.mts'

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })

function routedFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string) => {
    const url = input
    const match = Object.keys(routes).find((path) => url.includes(path))
    if (!match) throw new Error(`unexpected ${url}`)
    return routes[match]!()
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

describe('findRateLimitNamespaceCollisions', () => {
  it('pages through scripts and reports other Workers bound to desired namespaces', async () => {
    const fetchImpl = routedFetch({
      'scripts?page=1': () =>
        json({
          success: true,
          result: [{ id: 'self' }, { id: 'other' }],
          result_info: { total_pages: 2 },
        }),
      'scripts?page=2': () => json({ success: true, result: [{ id: 'quiet' }] }),
      '/other/settings': () =>
        json({
          success: true,
          result: {
            bindings: [
              { type: 'ratelimit', namespace_id: '1001' },
              { type: 'ratelimit', namespace_id: '2002' },
              { type: 'kv', namespace_id: '1001' },
              { type: 'ratelimit' },
            ],
          },
        }),
      '/quiet/settings': () => json({ success: true, result: {} }),
    })
    const collisions = await findRateLimitNamespaceCollisions(
      'acct',
      'tok',
      'self',
      new Set(['1001']),
      fetchImpl,
    )
    expect(collisions).toEqual([{ script: 'other', namespaceId: '1001' }])
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/accounts/acct/workers/scripts?page=1'),
      {
        headers: { authorization: 'Bearer tok' },
      },
    )
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining('/self/settings'),
      expect.anything(),
    )
  })

  it('surfaces HTTP, content-type, and envelope failures', async () => {
    const run = (response: Response) =>
      findRateLimitNamespaceCollisions(
        'a',
        't',
        's',
        new Set(),
        routedFetch({ scripts: () => response }),
      )
    await expect(run(new Response('x'.repeat(600), { status: 502 }))).rejects.toThrow(
      /request failed \(502\): x{500}$/,
    )
    await expect(
      run(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })),
    ).rejects.toThrow('returned a non-JSON response (200): <html>')
    await expect(run(new Response(null, { status: 200 }))).rejects.toThrow('non-JSON')
    await expect(run(json({ success: false, errors: [{ code: 1 }] }))).rejects.toThrow(
      '[{"code":1}]',
    )
    await expect(run(json({ success: false }))).rejects.toThrow('(200): []')
  })
})

describe('runRateLimitNamespaceCollisionCli', () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'tok' }
  const options = (
    over: Partial<Parameters<typeof runRateLimitNamespaceCollisionCli>[0]> = {},
  ) => ({
    args: ['1001'],
    targetScript: 'self',
    env,
    isMain: true,
    log: vi.fn(),
    check: vi.fn(async () => []),
    ...over,
  })

  it('does nothing when imported rather than run', async () => {
    const o = options({ isMain: false })
    await runRateLimitNamespaceCollisionCli(o)
    expect(o.check).not.toHaveBeenCalled()
  })

  it('requires credentials and namespace IDs', async () => {
    await expect(runRateLimitNamespaceCollisionCli(options({ env: {} }))).rejects.toThrow(
      'credentials',
    )
    await expect(runRateLimitNamespaceCollisionCli(options({ args: [] }))).rejects.toThrow(
      'namespace ID',
    )
  })

  it('throws on collisions and logs on success', async () => {
    const bad = options({ check: vi.fn(async () => [{ script: 'o', namespaceId: '1001' }]) })
    await expect(runRateLimitNamespaceCollisionCli(bad)).rejects.toThrow('"namespaceId":"1001"')
    const ok = options()
    await runRateLimitNamespaceCollisionCli(ok)
    expect(ok.check).toHaveBeenCalledWith('acct', 'tok', 'self', new Set(['1001']))
    expect(ok.log).toHaveBeenCalledWith(
      'Verified 1 rate-limit namespace IDs are unused by other Workers',
    )
  })

  it('defaults to the real finder', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json({ success: true, result: [] }))
    await runRateLimitNamespaceCollisionCli({ ...options(), check: undefined })
    expect(fetchSpy).toHaveBeenCalledOnce()
    fetchSpy.mockRestore()
  })
})
