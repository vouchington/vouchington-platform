import { describe, expect, it, vi } from 'vitest'
import { BatchError, DelayedError, type Job } from 'glide-mq'
import { createGuardedProcessors, type GuardedProcessorsConfig } from './guarded-processors.mts'

function job(id: string, deduplicationId?: string): never {
  return {
    id,
    opts: deduplicationId ? { deduplication: { id: deduplicationId } } : {},
  } as never
}

function setup(overrides: Partial<GuardedProcessorsConfig> = {}) {
  const release = vi.fn(async () => {})
  const lease = vi.fn(async (_queue: string, candidate: Job) =>
    candidate.id.startsWith('skip') ? null : release,
  )
  const onError = vi.fn()
  const logger = { error: vi.fn() }
  const guarded = createGuardedProcessors({ lease, onError, logger, ...overrides })
  return { release, lease, onError, logger, guarded }
}

describe('wrapSingleProcessor', () => {
  it('runs the processor and releases the lease', async () => {
    const { guarded, release, lease } = setup()
    const run = guarded.wrapSingleProcessor(async (j) => `done:${j.id}`, 'q', { lockDuration: 5 })
    expect(await run(job('a'))).toBe('done:a')
    expect(lease).toHaveBeenCalledWith('q', expect.objectContaining({ id: 'a' }), {
      lockDuration: 5,
    })
    expect(release).toHaveBeenCalledOnce()
  })

  it('skips the processor when the lease is refused', async () => {
    const { guarded } = setup()
    const processor = vi.fn()
    expect(await guarded.wrapSingleProcessor(processor, 'q', {})(job('skip-1'))).toBeUndefined()
    expect(processor).not.toHaveBeenCalled()
  })

  it('releases and rethrows a processor failure, reporting release failures', async () => {
    const { guarded, release, onError } = setup()
    release.mockRejectedValueOnce(new Error('release failed'))
    const failure = new Error('boom')
    const run = guarded.wrapSingleProcessor(async () => Promise.reject(failure), 'q', {})
    await expect(run(job('a'))).rejects.toBe(failure)
    expect(onError).toHaveBeenCalledWith(new Error('release failed'))
  })

  it('wraps a non-error release failure with its cause and survives a throwing reporter', async () => {
    const { guarded, release, onError, logger } = setup()
    release.mockRejectedValueOnce('plain')
    onError.mockImplementation(() => {
      throw new Error('reporter')
    })
    await guarded.wrapSingleProcessor(async () => 1, 'q', {})(job('a'))
    expect(logger.error).toHaveBeenCalledWith(
      'scheduled_lease_release_reporting_failed',
      new Error('reporter'),
    )
  })

  it('tolerates a missing reporter and uses the console by default', async () => {
    const { release } = setup()
    release.mockRejectedValueOnce(new Error('release failed'))
    const guarded = createGuardedProcessors({ lease: async () => release })
    await guarded.wrapSingleProcessor(async () => 1, 'q', {})(job('a'))
    const throwing = vi.spyOn(console, 'error').mockImplementation(() => {})
    const noisy = createGuardedProcessors({
      lease: async () => release,
      onError: () => {
        throw new Error('reporter')
      },
    })
    release.mockRejectedValueOnce(new Error('again'))
    await noisy.wrapSingleProcessor(async () => 1, 'q', {})(job('a'))
    expect(throwing).toHaveBeenCalledWith(
      'scheduled_lease_release_reporting_failed',
      expect.any(Error),
    )
    throwing.mockRestore()
  })
})

describe('wrapBatchProcessor', () => {
  it('runs only admitted jobs, keeps result positions, and releases every lease', async () => {
    const { guarded, release, lease } = setup()
    const processor = vi.fn(async (jobs: Job[]) => jobs.map((j) => `done:${j.id}`))
    const run = guarded.wrapBatchProcessor(processor, 'q', {})
    expect(await run([job('a'), job('skip-b'), job('c')])).toEqual(['done:a', undefined, 'done:c'])
    expect(processor.mock.calls[0]![0].map((j) => j.id)).toEqual(['a', 'c'])
    expect(lease).toHaveBeenCalledTimes(3)
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('remaps a partial BatchError to original positions, leaving skipped ticks undefined', async () => {
    const { guarded, release } = setup()
    const failure = new Error('second failed')
    const run = guarded.wrapBatchProcessor(
      async () => Promise.reject(new BatchError(['ok-a', failure])),
      'q',
      {},
    )
    const error = await run([job('a'), job('skip-b'), job('c')]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BatchError)
    expect((error as BatchError).results).toEqual(['ok-a', undefined, failure])
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('reports a missing partial result as a failure', async () => {
    const { guarded } = setup()
    const run = guarded.wrapBatchProcessor(async () => Promise.reject(new BatchError([])), 'q', {})
    const error = (await run([job('a')]).catch((e: unknown) => e)) as BatchError
    expect(error.results).toEqual([new Error('No result in BatchError')])
  })

  it('fails a deferred job with its DelayedError without aborting the rest of the batch', async () => {
    const { guarded, lease, release } = setup()
    const delayed = new DelayedError(123)
    lease.mockImplementation(async (_queue: string, candidate: Job) => {
      if (candidate.id === 'late') throw delayed
      return release
    })
    const processor = vi.fn(async (jobs: Job[]) => jobs.map((j) => `done:${j.id}`))
    const error = (await guarded
      .wrapBatchProcessor(
        processor,
        'q',
        {},
      )([job('a'), job('late')])
      .catch((e: unknown) => e)) as BatchError
    expect(error).toBeInstanceOf(BatchError)
    expect(error.results).toEqual(['done:a', delayed])
    expect(processor.mock.calls[0]![0].map((j) => j.id)).toEqual(['a'])
    expect(release).toHaveBeenCalledOnce()
  })

  it('does not call the processor when every job is skipped', async () => {
    const { guarded } = setup()
    const processor = vi.fn()
    expect(await guarded.wrapBatchProcessor(processor, 'q', {})([job('skip-a')])).toEqual([
      undefined,
    ])
    expect(processor).not.toHaveBeenCalled()
  })

  it('releases admitted leases when the processor or a later lease fails', async () => {
    const { guarded, release, lease } = setup()
    const failure = new Error('batch failed')
    await expect(
      guarded.wrapBatchProcessor(async () => Promise.reject(failure), 'q', {})([job('a')]),
    ).rejects.toBe(failure)
    expect(release).toHaveBeenCalledOnce()
    lease.mockResolvedValueOnce(release).mockRejectedValueOnce(new Error('lease down'))
    await expect(
      guarded.wrapBatchProcessor(async () => [], 'q', {})([job('a'), job('b')]),
    ).rejects.toThrow('lease down')
    expect(release).toHaveBeenCalledTimes(2)
  })
})

describe('self-add guard', () => {
  it('ignores adds outside a processor and for an empty id', () => {
    const { guarded } = setup()
    expect(guarded.isActiveProcessorJob('q', 'a')).toBe(false)
    expect(guarded.isActiveProcessorJob('q', undefined)).toBe(false)
    expect(guarded.rejectSelfAdd('q', 'work', { jobId: 'a' })).toBe(false)
  })

  it('detects the running job by queue and id inside a processor', async () => {
    const { guarded } = setup({ throwOnSelfAdd: false })
    const seen: boolean[] = []
    await guarded.wrapSingleProcessor(
      async () => {
        seen.push(
          guarded.isActiveProcessorJob('q', 'a'),
          guarded.isActiveProcessorJob('other', 'a'),
          guarded.isActiveProcessorJob('q', 'b'),
        )
      },
      'q',
      {},
    )(job('a'))
    expect(seen).toEqual([true, false, false])
  })

  it('throws by default, naming the active job, queue, and deduplication id', async () => {
    const { guarded } = setup()
    let caught: (Error & { extra?: Record<string, unknown> }) | undefined
    await guarded.wrapSingleProcessor(
      async () => {
        expect(guarded.rejectSelfAdd('q', 'work', { jobId: 'other' })).toBe(false)
        expect(guarded.rejectSelfAdd('other', 'work', { jobId: 'a' })).toBe(false)
        expect(guarded.rejectSelfAdd('q', 'work')).toBe(false)
        try {
          guarded.rejectSelfAdd('q', 'work', { deduplication: { id: 'dedup' } })
        } catch (error) {
          caught = error as typeof caught
        }
      },
      'q',
      {},
    )(job('a', 'dedup'))
    expect(caught?.message).toBe('Job a tried to add itself to queue q')
    expect(caught?.extra).toEqual({
      queue: 'q',
      jobName: 'work',
      jobId: null,
      dedupId: 'dedup',
      activeJobId: 'a',
      activeDedupId: 'dedup',
    })
  })

  it('reports and drops the add when throwing is off', async () => {
    const { guarded, onError } = setup({ throwOnSelfAdd: false })
    const dropped: boolean[] = []
    await guarded.wrapSingleProcessor(
      async () => {
        dropped.push(guarded.rejectSelfAdd('q', 'work', { jobId: 'a' }))
      },
      'q',
      {},
    )(job('a'))
    expect(dropped).toEqual([true])
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: expect.objectContaining({ jobId: 'a', dedupId: null, activeDedupId: null }),
      }),
    )
  })

  it('reaches the active batch through the same store', async () => {
    const { guarded } = setup({ throwOnSelfAdd: false })
    const seen: boolean[] = []
    await guarded.wrapBatchProcessor(
      async (jobs) => {
        seen.push(guarded.isActiveProcessorJob('q', 'a'), guarded.isActiveProcessorJob('q', 'b'))
        return jobs.map(() => 1)
      },
      'q',
      {},
    )([job('a'), job('b')])
    expect(seen).toEqual([true, true])
  })
})
