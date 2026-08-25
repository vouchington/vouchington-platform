import { describe, expect, it, vi } from 'vitest'

import { fetchWellKnownText, verifyWellKnownText, type SecureHttpTransport } from './well-known.mts'

describe('fetchWellKnownText', () => {
  it('gets and trims a text file through the caller security transport', async () => {
    const transport = transportFixture()
    transport.get
      .mockResolvedValueOnce(response(' token\n'))
      .mockResolvedValueOnce(response('token'))
    await expect(
      fetchWellKnownText('example.test', { path: '/.well-known/verify.txt', transport }),
    ).resolves.toBe('token')
    expect(transport.get).toHaveBeenCalledWith('https://example.test/.well-known/verify.txt', {
      headers: { Accept: 'text/plain' },
      timeoutMs: 10_000,
    })
    await expect(
      verifyWellKnownText('example.test', 'token', { path: '/.well-known/verify.txt', transport }),
    ).resolves.toBe(true)
  })

  it('returns null for unsafe/network, status, empty, and oversized responses', async () => {
    const transport = transportFixture()
    transport.get.mockRejectedValueOnce(new Error('blocked'))
    await expect(fetchWellKnownText('example.test', options(transport))).resolves.toBeNull()
    transport.get.mockResolvedValueOnce(response('not found', 404))
    await expect(fetchWellKnownText('example.test', options(transport))).resolves.toBeNull()
    transport.get.mockResolvedValueOnce(response('  '))
    await expect(fetchWellKnownText('example.test', options(transport))).resolves.toBeNull()
    transport.get.mockResolvedValueOnce(response('abc'))
    await expect(
      fetchWellKnownText('example.test', { ...options(transport), maxBytes: 2 }),
    ).resolves.toBeNull()
  })

  it('accepts a missing body and validates path and numeric limits', async () => {
    const transport = transportFixture()
    transport.get.mockResolvedValue(new Response(null, { status: 200 }))
    await expect(fetchWellKnownText('example.test', options(transport))).resolves.toBeNull()
    for (const invalid of [
      { path: 'relative' },
      { path: '//host/path' },
      { timeoutMs: 0 },
      { maxBytes: 0 },
    ]) {
      await expect(
        fetchWellKnownText('example.test', { ...options(transport), ...invalid }),
      ).rejects.toThrow()
    }
    for (const hostname of [
      'example.test@127.0.0.1',
      'example.test:443',
      'example.test/path',
      'café.test',
    ]) {
      await expect(fetchWellKnownText(hostname, options(transport))).rejects.toThrow(
        'ASCII DNS hostname',
      )
    }
  })

  it('cancels a response reader after an oversized body', async () => {
    const cancel = vi.fn(async () => {
      throw new Error('cleanup failed')
    })
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('abc'))
      },
      cancel,
    })
    const transport = transportFixture()
    transport.get.mockResolvedValue(new Response(stream))
    await expect(
      fetchWellKnownText('example.test', { ...options(transport), maxBytes: 2 }),
    ).resolves.toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
  })
})

function options(transport: SecureHttpTransport) {
  return { path: '/.well-known/verify.txt', transport }
}

function transportFixture() {
  return { get: vi.fn<SecureHttpTransport['get']>() }
}

function response(body: string, status = 200): Response {
  return new Response(body, { status })
}
