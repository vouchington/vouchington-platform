import { describe, expect, it } from 'vitest'

import { createTransactionLockOnce } from './transaction-lock-once.mts'
import { withPsql } from './test-helpers.mts'

describe('createTransactionLockOnce with PostgreSQL', () => {
  it('blocks a second transaction on the same id until the first commits', async () => {
    const id = crypto.randomUUID()
    const { lock } = createTransactionLockOnce({
      namespace: `lock-once-${id}:`,
      annotation: 'lockOnce',
    })
    await withPsql(async (psql) => {
      const first = await psql.beginTransaction()
      const second = await psql.beginTransaction()
      try {
        await lock(first, [id.toUpperCase()])
        await lock(first, [id])

        let secondLocked = false
        const secondLock = lock(second, [id]).then(() => {
          secondLocked = true
        })
        await new Promise((resolve) => setTimeout(resolve, 300))
        expect(secondLocked).toBe(false)

        await first.commit()
        await secondLock
        expect(secondLocked).toBe(true)
        await second.commit()
      } finally {
        await first.rollback().catch(() => undefined)
        await second.rollback().catch(() => undefined)
      }
    })
  })

  it('locks different ids in one transaction without blocking another id', async () => {
    const { lock } = createTransactionLockOnce({
      namespace: `lock-once-${crypto.randomUUID()}:`,
      annotation: 'lockOnce',
    })
    await withPsql(async (psql) => {
      await psql.withTransaction(async (query) => {
        await Promise.all([lock(query, ['b', 'a']), lock(query, ['c', 'a'])])
      })
      await psql.withTransaction(async (query) => {
        await lock(query, ['a', 'b', 'c'])
      })
    })
  })
})
