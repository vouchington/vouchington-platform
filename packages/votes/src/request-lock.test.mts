import { describe, expect, it, vi } from 'vitest'

import { createVoteRequestLock } from './request-lock.mts'

const USER_ID = '00000000-0000-7000-8000-000000000001'
const ENTITY_ID = '00000000-0000-7000-8000-000000000002'

function runtime(options: { unlock?: boolean; lockError?: Error; unlockError?: Error } = {}) {
  const release = vi.fn()
  const query = vi.fn(async (statement: string) => {
    if (statement.includes('lockVoteRequest') && options.lockError) throw options.lockError
    if (statement.includes('unlockVoteRequest')) {
      if (options.unlockError) throw options.unlockError
      return { rows: [{ unlocked: options.unlock ?? true }] }
    }
    return { rows: [] }
  })
  const psql = {
    advisoryLockPool: { connect: vi.fn(async () => ({ query, release })) },
  }
  return { psql: psql as never, query, release }
}

describe('vote request lock', () => {
  it('serializes work and cleanly releases a held lock', async () => {
    const { psql, query, release } = runtime()
    const lock = createVoteRequestLock(psql, 'article-votes')
    await expect(lock(USER_ID, ENTITY_ID, async () => 'done')).resolves.toBe('done')
    expect(query).toHaveBeenCalledTimes(2)
    expect(release).toHaveBeenCalledWith()
  })

  it('validates configuration and lock identities', async () => {
    const { psql } = runtime()
    expect(() => createVoteRequestLock(psql, '')).toThrow('namespace')
    const lock = createVoteRequestLock(psql, 'votes')
    await expect(lock('bad', ENTITY_ID, async () => undefined)).rejects.toThrow('userId')
    await expect(lock(USER_ID, 'bad', async () => undefined)).rejects.toThrow('entityId')
  })

  it('preserves work failures after a successful unlock', async () => {
    const { psql, release } = runtime()
    const failure = new Error('work failed')
    const lock = createVoteRequestLock(psql, 'votes')
    await expect(
      lock(USER_ID, ENTITY_ID, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    expect(release).toHaveBeenCalledWith()
  })

  it('normalizes non-Error work failures', async () => {
    const { psql } = runtime()
    await expect(
      createVoteRequestLock(psql, 'votes')(USER_ID, ENTITY_ID, async () => {
        throw 'string failure'
      }),
    ).rejects.toThrow('string failure')
  })

  it('taints clients when locking or unlocking fails', async () => {
    const lockFailure = new Error('lock failed')
    const failedLock = runtime({ lockError: lockFailure })
    await expect(
      createVoteRequestLock(failedLock.psql, 'votes')(USER_ID, ENTITY_ID, async () => undefined),
    ).rejects.toBe(lockFailure)
    expect(failedLock.release).toHaveBeenCalledWith(true)

    const missing = runtime({ unlock: false })
    await expect(
      createVoteRequestLock(missing.psql, 'votes')(USER_ID, ENTITY_ID, async () => undefined),
    ).rejects.toThrow('was not held')
    expect(missing.release).toHaveBeenCalledWith(true)
  })

  it('keeps the work error and attaches an unlock failure as its cause', async () => {
    const unlockFailure = new Error('unlock failed')
    const { psql, release } = runtime({ unlockError: unlockFailure })
    const workFailure = new Error('work failed')
    await expect(
      createVoteRequestLock(psql, 'votes')(USER_ID, ENTITY_ID, async () => {
        throw workFailure
      }),
    ).rejects.toBe(workFailure)
    expect(workFailure.cause).toBe(unlockFailure)
    expect(release).toHaveBeenCalledWith(true)
  })
})
