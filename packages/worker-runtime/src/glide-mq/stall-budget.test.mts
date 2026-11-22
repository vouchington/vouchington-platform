import { describe, expect, it, vi } from 'vitest'
import { UnrecoverableError, type Job } from 'glide-mq'
import { DEFAULT_MAX_STALLED_COUNT, withStallBudget } from './stall-budget.mts'

const job = (id: string, backoff?: string) =>
  ({ id, opts: backoff ? { backoff: { type: backoff } } : {} }) as unknown as Job

describe('withStallBudget', () => {
  it('runs a job within the default budget', async () => {
    const hget = vi.fn(async () => String(DEFAULT_MAX_STALLED_COUNT))
    const run = withStallBudget('q', async (j) => j.id, { hget })
    expect(await run(job('a'))).toBe('a')
    expect(hget).toHaveBeenCalledWith('glide:{q}:job:a', 'stalledCount')
  })

  it('fails a job over the budget before its handler runs', async () => {
    const processor = vi.fn()
    const run = withStallBudget('q', processor, { hget: async () => '3', prefix: 'app' })
    await expect(run(job('a'))).rejects.toBeInstanceOf(UnrecoverableError)
    expect(processor).not.toHaveBeenCalled()
  })

  it('honors a custom budget and treats a missing count as zero', async () => {
    const options = { hget: async () => '3', maxStalledCount: 5 }
    expect(await withStallBudget('q', async () => 'ok', options)(job('a'))).toBe('ok')
    expect(await withStallBudget('q', async () => 'ok', { hget: async () => null })(job('a'))).toBe(
      'ok',
    )
  })

  it('skips the check for exempt jobs', async () => {
    const hget = vi.fn(async () => '99')
    const run = withStallBudget('q', async (j) => j.id, {
      hget,
      exempt: (j) => j.opts.backoff?.type.startsWith('exempt-') === true,
    })
    expect(await run(job('a', 'exempt-x'))).toBe('a')
    expect(hget).not.toHaveBeenCalled()
    await expect(run(job('b', 'other'))).rejects.toBeInstanceOf(UnrecoverableError)
  })
})
