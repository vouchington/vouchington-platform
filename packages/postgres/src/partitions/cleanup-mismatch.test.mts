import { describe, expect, it, vi } from 'vitest'

import { cleanupMonthlyPartitions } from './retire.mts'

const rows = [
  { parent_table: 'a', partition_table: 'a__p_2020_01', partition_bound: 'DEFAULT' },
  { parent_table: 'a', partition_table: 'a__p_2020_02', partition_bound: null },
]

describe('cleanupMonthlyPartitions bound verification', () => {
  it('reports mismatched children without retiring them, surviving a rejecting reporter', async () => {
    const query = vi.fn(async (_sql: string) => ({ rows }))
    const startTransaction = vi.fn()
    const messages: string[] = []
    await cleanupMonthlyPartitions({
      query: query as never,
      tables: [{ table: 'a', retentionDays: 1 }],
      referenceDate: new Date(Date.UTC(2026, 5, 15)),
      startTransaction,
      reportError: async (error) => {
        messages.push(error.message)
        throw new Error('flush failed')
      },
    })
    expect(startTransaction).not.toHaveBeenCalled()
    expect(messages).toEqual([
      'Skipped monthly partition a__p_2020_01: bound DEFAULT does not match its name',
      'Skipped monthly partition a__p_2020_02: bound null does not match its name',
    ])
    expect(query.mock.calls[0]?.[0]).toContain('pg_get_expr(child.relpartbound')
  })
})
