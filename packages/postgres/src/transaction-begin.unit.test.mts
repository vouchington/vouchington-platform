import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import { beginTransactionBatch } from './transaction-begin.mts'

type BatchClient = Parameters<typeof beginTransactionBatch>[0]

function noticeClient(pipeline?: boolean) {
  const client = new EventEmitter() as EventEmitter & BatchClient & { pipeline?: boolean }
  if (pipeline !== undefined) client.pipeline = pipeline
  return client
}

describe('beginTransactionBatch', () => {
  it('submits every statement in pipeline mode and returns the first statement', async () => {
    const client = noticeClient(false)
    const seen: Array<boolean | undefined> = []
    const outcome = await beginTransactionBatch(
      client,
      [async () => seen.push(client.pipeline), async () => seen.push(client.pipeline)],
      async () => {
        seen.push(client.pipeline)
        return 'row'
      },
    )
    expect(seen).toEqual([true, true, true])
    expect(outcome).toEqual({ kind: 'begun', first: { status: 'fulfilled', value: 'row' } })
    expect(client.pipeline).toBe(false)
    expect(client.listenerCount('notice')).toBe(0)
  })

  it('reports a nested BEGIN without exposing the first statement', async () => {
    const client = noticeClient()
    const outcome = await beginTransactionBatch(
      client,
      [
        async () => {
          client.emit('notice', { code: '25001' })
        },
      ],
      async () => 'abandoned row',
    )
    expect(outcome.kind).toBe('failed')
    expect(outcome.kind === 'failed' && String(outcome.error)).toContain(
      'already has a transaction open',
    )
    expect(client.pipeline).toBeUndefined()
    expect(client.listenerCount('notice')).toBe(0)
  })

  it('ignores unrelated notices and returns a failed first statement', async () => {
    const client = noticeClient()
    const failure = new Error('statement failed')
    const outcome = await beginTransactionBatch(
      client,
      [
        async () => {
          client.emit('notice', { code: '00000' })
        },
      ],
      async () => {
        throw failure
      },
    )
    expect(outcome).toEqual({ kind: 'begun', first: { status: 'rejected', reason: failure } })
  })

  it('reports a failed control statement', async () => {
    const client = noticeClient()
    const failure = new Error('begin failed')
    const outcome = await beginTransactionBatch(
      client,
      [
        async () => {
          throw failure
        },
      ],
      async () => 'row',
    )
    expect(outcome).toEqual({ kind: 'failed', error: failure })
    expect(client.listenerCount('notice')).toBe(0)
  })
})
