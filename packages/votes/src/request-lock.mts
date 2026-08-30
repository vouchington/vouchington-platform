import type { PoolClient, Psql } from '@vouchington/postgres'

import { assertUuid } from './identifiers.mts'

export function createVoteRequestLock(psql: Psql, namespace: string) {
  if (namespace.length === 0) throw new Error('Vote request lock namespace must not be empty')
  return async function withVoteRequestLock<Result>(
    userId: string,
    entityId: string,
    work: () => Promise<Result>,
  ): Promise<Result> {
    assertUuid(userId, 'userId')
    assertUuid(entityId, 'entityId')
    return withSessionLock(psql, `${namespace}:${userId}:${entityId}`, work)
  }
}

async function withSessionLock<Result>(
  psql: Psql,
  key: string,
  work: () => Promise<Result>,
): Promise<Result> {
  const client = await psql.advisoryLockPool.connect()
  let released = false
  let workError: Error | undefined
  let result: Result | undefined
  try {
    await client.query('/* lockVoteRequest */ SELECT pg_advisory_lock(hashtextextended($1, 0))', [
      key,
    ])
    try {
      result = await work()
    } catch (error) {
      workError = toError(error)
    }
    const unlockError = await unlock(client, key)
    if (unlockError) {
      client.release(true)
      released = true
      if (workError) {
        workError.cause ??= unlockError
        throw workError
      }
      throw unlockError
    }
    client.release()
    released = true
    if (workError) throw workError
    return result as Result
  } catch (error) {
    if (!released) client.release(true)
    throw toError(error)
  }
}

async function unlock(client: PoolClient, key: string): Promise<Error | undefined> {
  try {
    const result = await client.query<{ unlocked: boolean }>(
      '/* unlockVoteRequest */ SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked',
      [key],
    )
    return result.rows[0]?.unlocked ? undefined : new Error('Vote request lock was not held')
  } catch (error) {
    return toError(error)
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
