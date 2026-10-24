import { describe, expect, it } from 'vitest'

import { restoreIds, withUniqueIds } from './batch-ids.mts'

describe('withUniqueIds', () => {
  it('leaves single messages and batches with distinct ids alone', () => {
    const batch = [{ id: 1 }, { id: 2 }, { method: 'notifications/initialized' }]

    expect(withUniqueIds({ id: 1 }).parsedBody).toEqual({ id: 1 })
    expect(withUniqueIds(batch).parsedBody).toBe(batch)
    expect(withUniqueIds(batch).originalIds.size).toBe(0)
  })

  it('renames every identified message of a batch that reuses an id, keeping the rest', () => {
    const { parsedBody, originalIds } = withUniqueIds([
      { id: 'same', method: 'a' },
      null,
      { method: 'notification' },
      { id: 'same', method: 'b' },
      { id: 7, method: 'c' },
      { id: {}, method: 'd' },
    ])

    expect(parsedBody).toEqual([
      { id: 'batch-0', method: 'a' },
      null,
      { method: 'notification' },
      { id: 'batch-3', method: 'b' },
      { id: 'batch-4', method: 'c' },
      { id: {}, method: 'd' },
    ])
    expect([...originalIds]).toEqual([
      ['batch-0', 'same'],
      ['batch-3', 'same'],
      ['batch-4', 7],
    ])
  })
})

describe('restoreIds', () => {
  const ids = new Map<string | number, string | number>([['batch-0', 'same']])
  const restored = async (payload: unknown) =>
    (
      await restoreIds(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
        }),
        ids,
      )
    ).json()

  it('restores the original id of each reply and keeps status and headers', async () => {
    const response = await restoreIds(
      new Response('[{"id":"batch-0"},{"id":"other"},{"result":1}]', {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
      }),
      ids,
    )

    expect(await response.json()).toEqual([{ id: 'same' }, { id: 'other' }, { result: 1 }])
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(response.headers.has('Content-Length')).toBe(false)
  })

  it('restores a single reply and passes a non-object reply through', async () => {
    expect(await restored({ id: 'batch-0', result: {} })).toEqual({ id: 'same', result: {} })
    expect(await restored(null)).toBeNull()
  })
})
