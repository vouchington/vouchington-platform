import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import { beginTransactionBlock } from './transaction-begin.mts'

function noticeClient() {
  return new EventEmitter() as EventEmitter & Parameters<typeof beginTransactionBlock>[0]
}

describe('beginTransactionBlock', () => {
  it('rejects when BEGIN reports an already-active transaction', async () => {
    const client = noticeClient()
    await expect(
      beginTransactionBlock(client, async () => {
        client.emit('notice', { code: '25001' })
      }),
    ).rejects.toThrow('already has a transaction open')
    expect(client.listenerCount('notice')).toBe(0)
  })

  it('ignores unrelated notices', async () => {
    const client = noticeClient()
    await beginTransactionBlock(client, async () => {
      client.emit('notice', { code: '00000' })
    })
    expect(client.listenerCount('notice')).toBe(0)
  })

  it('removes its listener when BEGIN fails', async () => {
    const client = noticeClient()
    const failure = new Error('begin failed')
    await expect(
      beginTransactionBlock(client, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    expect(client.listenerCount('notice')).toBe(0)
  })
})
