import sql from 'sql-template-strings'
import { describe, expect, it, vi } from 'vitest'

import { PIPELINE_BATCH_MAX, createPipelineBatch } from './pipeline-batch.mts'
import { Cursor } from './cursor-support.mts'
import type { PsqlRuntime } from './types.mts'

function runtime(): PsqlRuntime {
  return {
    pools: {
      write: { connect: vi.fn() } as never,
      read: { connect: vi.fn() } as never,
      advisoryLock: { connect: vi.fn() } as never,
    },
    env: { NODE_ENV: 'test' },
    errorHandler: () => {},
  }
}

describe('pipelineBatch validation', () => {
  it('rejects oversized batches and returns empty without connecting', async () => {
    const readConnect = vi.fn()
    const context: PsqlRuntime = {
      pools: {
        write: { connect: vi.fn() } as never,
        read: { connect: readConnect } as never,
        advisoryLock: { connect: vi.fn() } as never,
      },
      env: { NODE_ENV: 'test' },
      errorHandler: () => {},
    }
    const pipelineBatch = createPipelineBatch(context)
    await expect(
      pipelineBatch(Array.from({ length: PIPELINE_BATCH_MAX + 1 }, () => '/* n */ SELECT 1')),
    ).rejects.toThrow(`pipelineBatch supports at most ${PIPELINE_BATCH_MAX} queries`)
    await expect(pipelineBatch([])).resolves.toEqual([])
    expect(readConnect).not.toHaveBeenCalled()
  })

  it('rejects COPY, transaction control, and Submittable objects', async () => {
    const pipelineBatch = createPipelineBatch(runtime())
    await expect(pipelineBatch(['/* copy */ COPY items FROM STDIN'])).rejects.toThrow(
      'does not accept COPY statements',
    )
    await expect(pipelineBatch(['/* begin */ BEGIN'])).rejects.toThrow(
      'does not accept transaction-control statements',
    )
    await expect(
      pipelineBatch([
        {
          submit() {
            throw new Error('no')
          },
        } as never,
      ]),
    ).rejects.toThrow('does not accept Submittable query objects')
    await expect(pipelineBatch([new Cursor('/* cursor */ SELECT 1') as never])).rejects.toThrow(
      'does not accept Submittable query objects',
    )
    await expect(pipelineBatch([{ submit: 1 } as never])).rejects.toThrow(
      'pipelineBatch accepts only annotated SQL strings or SQLStatement values',
    )
    await expect(pipelineBatch([{} as never])).rejects.toThrow(
      'pipelineBatch accepts only annotated SQL strings or SQLStatement values',
    )
  })

  it('accepts SQLStatement snapshots', async () => {
    const context = runtime()
    const pipelineBatch = createPipelineBatch(context)
    context.pools.read.connect = vi.fn(async () => {
      throw new Error('connected')
    }) as never
    await expect(pipelineBatch([sql`/* stmt */ SELECT 1`])).rejects.toThrow('connected')
    const withValues = sql`/* stmt */ SELECT 1`
    withValues.values = undefined as never
    await expect(pipelineBatch([withValues])).rejects.toThrow('connected')
    await expect(pipelineBatch([sql`/* stmt */ SELECT ${1}`])).rejects.toThrow('connected')
  })

  it('runs on the write pool, restores pipeline state, and destroys broken clients', async () => {
    const release = vi.fn()
    const client = {
      pipeline: true,
      _queryable: false,
      query: async () => ({ rows: [{ n: 1 }], rowCount: 1 }),
      release,
    }
    const context = runtime()
    context.pools.write.connect = vi.fn(async () => client) as never
    const results = await createPipelineBatch(context)(['/* one */ SELECT 1'], { readOnly: false })
    expect(results).toHaveLength(1)
    expect(client.pipeline).toBe(true)
    expect(release).toHaveBeenCalledWith(true)
  })

  it('rejects the first failed pipelined query', async () => {
    const release = vi.fn()
    let calls = 0
    const client = {
      query: async () => {
        calls += 1
        if (calls === 2) throw new Error('second failed')
        return { rows: [], rowCount: 0 }
      },
      release,
    }
    const context = runtime()
    context.pools.read.connect = vi.fn(async () => client) as never
    await expect(
      createPipelineBatch(context)(['/* one */ SELECT 1', '/* two */ SELECT 1']),
    ).rejects.toThrow('second failed')
    expect(release).toHaveBeenCalledWith()
  })

  it('classifies line comments at EOF and unclosed blocks', async () => {
    const pipelineBatch = createPipelineBatch(runtime())
    await expect(pipelineBatch(['/* q */ COPY items FROM STDIN --'])).rejects.toThrow(
      'does not accept COPY statements',
    )
    await expect(pipelineBatch(['/* q */ COPY items FROM STDIN /*'])).rejects.toThrow(
      'does not accept COPY statements',
    )
  })

  it('classifies nested blocks and line comments with newlines', async () => {
    const pipelineBatch = createPipelineBatch(runtime())
    await expect(
      pipelineBatch(['/* q */ /* outer /* nested */ */ COPY items FROM STDIN']),
    ).rejects.toThrow('does not accept COPY statements')
    await expect(pipelineBatch(['/* q */ COPY items FROM STDIN -- c\n'])).rejects.toThrow(
      'does not accept COPY statements',
    )
  })
})
