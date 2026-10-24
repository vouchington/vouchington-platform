import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clientOptions: [] as Array<Record<string, unknown>>,
  resolverOptions: [] as Array<{ fetch: (input: string, init?: RequestInit) => Promise<Response> }>,
}))

vi.mock('@atproto/oauth-client-node', () => ({
  NodeOAuthClient: class {
    constructor(options: Record<string, unknown>) {
      mocks.clientOptions.push(options)
    }
  },
}))
vi.mock('@atproto-labs/handle-resolver-node', () => ({
  AtprotoHandleResolverNode: class {
    constructor(options: { fetch: (input: string, init?: RequestInit) => Promise<Response> }) {
      mocks.resolverOptions.push(options)
    }
  },
}))

const { createAtprotoOAuthClient } = await import('./create-client.mts')

const base = {
  clientMetadata: {} as never,
  keyset: {} as never,
  stateStore: {} as never,
  sessionStore: {} as never,
}

describe('createAtprotoOAuthClient wiring', () => {
  beforeEach(() => {
    mocks.clientOptions.length = 0
    mocks.resolverOptions.length = 0
  })

  it('passes stores, metadata, and keyset to the SDK and omits an absent requestLock', () => {
    createAtprotoOAuthClient({ ...base, fetch: vi.fn() as never })
    const [options] = mocks.clientOptions
    expect(options).toMatchObject({ ...base })
    expect(options).not.toHaveProperty('requestLock')
    expect(typeof options?.fetch).toBe('function')
  })

  it('passes the requestLock through', () => {
    const requestLock = vi.fn()
    createAtprotoOAuthClient({ ...base, fetch: vi.fn() as never, requestLock })
    expect(mocks.clientOptions[0]?.requestLock).toBe(requestLock)
  })

  it('gives the handle resolver the unwrapped base fetch, with the operation signal applied', async () => {
    const fetch = vi.fn(async () => new Response('{}'))
    const operation = new AbortController()
    createAtprotoOAuthClient({ ...base, fetch: fetch as never, operationSignal: operation.signal })
    const [resolver] = mocks.resolverOptions
    // The unwrapped fetch does not apply the loopback policy; the resolver adds its own.
    await resolver!.fetch('http://127.0.0.1/handle')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1/handle')
    expect(init.signal).toBe(operation.signal)
    expect(mocks.clientOptions[0]?.fetch).not.toBe(resolver!.fetch)
  })
})
