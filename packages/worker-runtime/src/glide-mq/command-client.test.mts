import { describe, expect, it, vi } from 'vitest'

import { createRetryingCommandClient, type RetryContext } from './command-client.mts'

type Fake = { get: (key: string) => Promise<string>; label: string; close: () => Promise<void> }

function setup(overrides: { connect?: () => Promise<Fake> } = {}) {
  const close = vi.fn(async () => undefined)
  const real: Fake = { get: vi.fn(async (key: string) => `value:${key}`), label: 'real', close }
  const connect = vi.fn(overrides.connect ?? (async () => real))
  const retryImpl = <T,>(fn: () => Promise<T>, _context: RetryContext) => fn()
  const retry = vi.fn(retryImpl)
  const handle = createRetryingCommandClient<Fake>({
    name: 'shared',
    connect,
    retry: retry as typeof retryImpl,
  })
  return { handle, real, connect, retry, close }
}

describe('createRetryingCommandClient', () => {
  it('connects lazily once and routes every command through retry', async () => {
    const { handle, real, connect, retry } = setup()
    expect(connect).not.toHaveBeenCalled()

    await expect(handle.client.get('a')).resolves.toBe('value:a')
    await expect(handle.client.get('b')).resolves.toBe('value:b')

    expect(connect).toHaveBeenCalledTimes(1)
    expect(real.get).toHaveBeenCalledWith('a')
    expect(retry).toHaveBeenCalledWith(expect.any(Function), { command: 'get', client: 'shared' })
  })

  it('returns non-function properties through the promise', async () => {
    const { handle } = setup()

    await expect((handle.client.label as unknown as () => Promise<string>)()).resolves.toBe('real')
  })

  it('is not thenable and passes the constructor through', () => {
    const { handle } = setup()
    expect((handle.client as { then?: unknown }).then).toBeUndefined()
    expect(handle.client.constructor).toBe(Object)

    class Client {}
    const custom = createRetryingCommandClient({
      name: 'x',
      connect: async () => ({}),
      retry: (fn) => fn(),
      clientConstructor: Client,
    })
    expect(custom.client.constructor).toBe(Client)
  })

  it('propagates connect failures through retry', async () => {
    const { handle } = setup({ connect: () => Promise.reject(new Error('connect failed')) })

    await expect(handle.client.get('a')).rejects.toThrow('connect failed')
  })

  it('retries the connection after a failed attempt', async () => {
    let attempts = 0
    const { handle, real } = setup({
      connect: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('down')
        return real
      },
    })

    await expect(handle.client.get('a')).rejects.toThrow('down')
    await expect(handle.client.get('a')).resolves.toBe('value:a')
    expect(attempts).toBe(2)
  })

  it('refuses to connect after close, so a late command cannot leak a client', async () => {
    const { handle, connect } = setup()
    await handle.close()

    await expect(handle.client.get('a')).rejects.toThrow('is closed')
    expect(connect).not.toHaveBeenCalled()
  })

  it('does not fabricate absent properties such as clusterScan', () => {
    const { handle } = setup()
    expect((handle.client as { clusterScan?: unknown }).clusterScan).toBeUndefined()

    const custom = createRetryingCommandClient<Fake>({
      name: 'x',
      connect: async () => ({}) as Fake,
      retry: (fn) => fn(),
      absentProperties: ['other'],
    })
    expect((custom.client as { other?: unknown }).other).toBeUndefined()
    expect(typeof (custom.client as { clusterScan?: unknown }).clusterScan).toBe('function')
  })

  it('closes safely before connect without opening a connection', async () => {
    const { handle, connect, close } = setup()

    await handle.close()
    await handle.close()

    expect(connect).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('closes the real client once after connect', async () => {
    const { handle, close } = setup()
    await handle.client.get('a')

    await Promise.all([handle.close(), handle.close()])
    await handle.close()

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('waits for an in-flight connection before closing', async () => {
    let finish!: (client: Fake) => void
    const { handle, real, close } = setup({
      connect: () => new Promise<Fake>((resolve) => (finish = resolve)),
    })
    const pending = handle.client.get('a')
    const closing = handle.close()
    expect(close).not.toHaveBeenCalled()

    finish(real)
    await closing
    await pending

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('tolerates a real client without close', async () => {
    const handle = createRetryingCommandClient<{ ping(): Promise<string> }>({
      name: 'bare',
      connect: async () => ({ ping: async () => 'pong' }),
      retry: (fn) => fn(),
    })
    await handle.client.ping()

    await expect(handle.close()).resolves.toBeUndefined()
  })
})
