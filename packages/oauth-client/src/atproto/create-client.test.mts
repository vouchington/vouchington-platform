import dns from 'node:dns'
import { syncBuiltinESMExports } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAtprotoOAuthClient } from './create-client.mts'
import { parseEcKeyset } from './keyset.mts'
import { makeJwk, makeMetadata, sessionStore, stateStore, toEnv } from './test-helpers.mts'

async function build(
  fetch: typeof globalThis.fetch,
  extra: { operationSignal?: AbortSignal } = {},
) {
  const keyset = await parseEcKeyset({ env: toEnv([makeJwk('client-key')]), mode: 'production' })
  const client = createAtprotoOAuthClient({
    clientMetadata: makeMetadata(keyset.publicJwks),
    keyset,
    stateStore: stateStore(),
    sessionStore: sessionStore(),
    fetch: fetch as never,
    ...extra,
  })
  return client
}

// `Fetch` declares a `this` type that a method receiver cannot satisfy, so call it unbound.
const send = (client: Awaited<ReturnType<typeof build>>, ...args: Parameters<typeof fetch>) => {
  const call = client.fetch
  return call(...args)
}

const causes = (error: unknown): string[] => {
  const messages: string[] = []
  for (let current = error; current instanceof Error; current = current.cause) {
    messages.push(current.message)
  }
  return messages
}

describe('createAtprotoOAuthClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    syncBuiltinESMExports()
  })

  it('constructs a client from private_key_jwt metadata and an inline jwks', async () => {
    const client = await build(vi.fn())
    expect(client.clientMetadata.token_endpoint_auth_method).toBe('private_key_jwt')
    expect(client.clientMetadata.client_id).toBe('https://app.example.com/client-metadata.json')
  })

  it('rejects metadata whose jwks does not match the keyset', async () => {
    const keyset = await parseEcKeyset({ env: toEnv([makeJwk('k')]), mode: 'production' })
    const other = await parseEcKeyset({ env: toEnv([makeJwk('other')]), mode: 'production' })
    expect(() =>
      createAtprotoOAuthClient({
        clientMetadata: makeMetadata(other.publicJwks),
        keyset,
        stateStore: stateStore(),
        sessionStore: sessionStore(),
        fetch: vi.fn() as never,
      }),
    ).toThrow()
  })

  it('passes requests through the injected fetch with the request signal untouched', async () => {
    const fetch = vi.fn(async () => new Response('{}'))
    const client = await build(fetch)
    const signal = new AbortController().signal
    await send(client, 'https://example.com/a', { signal })
    const init = (fetch.mock.calls[0] as unknown[])[1] as RequestInit
    expect(init.signal).toBe(signal)
  })

  it('passes undefined init through when there is nothing to combine', async () => {
    const fetch = vi.fn(async () => new Response('{}'))
    const client = await build(fetch)
    await send(client, 'https://example.com/a')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('applies the operation signal alone or combined with the request signal', async () => {
    const operation = new AbortController()
    const fetch = vi.fn(async () => new Response('{}'))
    const client = await build(fetch, { operationSignal: operation.signal })
    await send(client, 'https://example.com/a')
    expect(((fetch.mock.calls[0] as unknown[])[1] as RequestInit).signal).toBe(operation.signal)

    const request = new AbortController()
    await send(client, 'https://example.com/b', { signal: request.signal })
    const combined = ((fetch.mock.calls[1] as unknown[])[1] as RequestInit).signal!
    expect(combined).not.toBe(request.signal)
    expect(combined.aborted).toBe(false)
    operation.abort()
    expect(combined.aborted).toBe(true)
  })

  it('keeps the signal carried by a Request input when combining', async () => {
    const operation = new AbortController()
    const fetch = vi.fn(async () => new Response('{}'))
    const client = await build(fetch, { operationSignal: operation.signal })
    const request = new AbortController()
    await send(client, new Request('https://example.com/c', { signal: request.signal }))
    const combined = ((fetch.mock.calls[0] as unknown[])[1] as RequestInit).signal!
    expect(combined.aborted).toBe(false)
    request.abort()
    expect(combined.aborted).toBe(true)
  })

  it('rejects literal loopback addresses before any request', async () => {
    const fetch = vi.fn()
    const client = await build(fetch)
    const error = await send(client, 'http://127.0.0.1/oauth').catch((e: unknown) => e)
    expect(error).toMatchObject({ message: 'fetch failed' })
    expect(causes(error)).toContain('Hostname is a non-unicast address')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a hostname that DNS resolves to loopback', async () => {
    const lookup = vi.fn(
      (
        _hostname: string,
        _options: unknown,
        callback: (error: Error | null, addresses: { address: string; family: number }[]) => void,
      ) => callback(null, [{ address: '127.0.0.1', family: 4 }]),
    )
    vi.spyOn(dns, 'lookup').mockImplementation(lookup as never)
    syncBuiltinESMExports()
    const client = await build((input, init) => globalThis['fetch'](input, init))
    const error = await send(client, 'http://example.com/oauth').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TypeError)
    expect(causes(error)).toContain('Hostname resolved to non-unicast address')
    expect(lookup).toHaveBeenCalledWith('example.com', expect.any(Object), expect.any(Function))
  })
})
