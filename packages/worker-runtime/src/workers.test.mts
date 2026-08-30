import type { Worker } from 'glide-mq'
import { describe, expect, it, vi } from 'vitest'

import { loadWorkers, selectedWorkerDefinitions, type WorkerDefinition } from './workers.mts'

function worker(queueName: string): Worker {
  return { queueName } as unknown as Worker
}

function definitions(): WorkerDefinition[] {
  return [
    { queueName: 'email', load: vi.fn(() => Promise.resolve(worker('email'))) },
    { queueName: 'images', load: vi.fn(() => Promise.resolve(worker('images'))) },
    {
      queueName: 'maintenance',
      requiresExplicitInclusion: true,
      load: vi.fn(() => Promise.resolve(worker('maintenance'))),
    },
  ]
}

describe('selectedWorkerDefinitions', () => {
  it('selects non-explicit definitions by default and preserves definition order', () => {
    expect(
      selectedWorkerDefinitions(definitions(), undefined).map((item) => item.queueName),
    ).toEqual(['email', 'images'])
  })

  it('selects explicit definitions only from include lists and supports excludes', () => {
    expect(
      selectedWorkerDefinitions(definitions(), 'maintenance').map((item) => item.queueName),
    ).toEqual(['maintenance'])
    expect(
      selectedWorkerDefinitions(definitions(), '-images').map((item) => item.queueName),
    ).toEqual(['email'])
  })

  it('drops and reports unknown includes to tolerate deployment skew', () => {
    const onUnknownIncludes = vi.fn<(names: readonly string[]) => void>()

    const selected = selectedWorkerDefinitions(definitions(), 'email,new-queue', onUnknownIncludes)

    expect(selected.map((item) => item.queueName)).toEqual(['email'])
    expect(onUnknownIncludes).toHaveBeenCalledExactlyOnceWith(['new-queue'])
  })

  it('uses a no-op reporter when callers do not need skew diagnostics', () => {
    expect(selectedWorkerDefinitions(definitions(), 'new-queue')).toEqual([])
  })

  it('recognizes queues consumed by sibling runtimes without loading them', () => {
    const onUnknownIncludes = vi.fn<(names: readonly string[]) => void>()

    const selected = selectedWorkerDefinitions(
      definitions(),
      'email,sqs-events',
      onUnknownIncludes,
      ['sqs-events'],
    )

    expect(selected.map((item) => item.queueName)).toEqual(['email'])
    expect(onUnknownIncludes).not.toHaveBeenCalled()
  })
})

describe('loadWorkers', () => {
  it('loads selected definitions and returns their workers', async () => {
    const runtimeDefinitions = definitions()

    const workers = await loadWorkers(runtimeDefinitions, 'images,email')

    expect(workers).toEqual([worker('email'), worker('images')])
    expect(runtimeDefinitions[0]!.load).toHaveBeenCalledOnce()
    expect(runtimeDefinitions[1]!.load).toHaveBeenCalledOnce()
    expect(runtimeDefinitions[2]!.load).not.toHaveBeenCalled()
  })

  it('propagates loader failures', async () => {
    const failure = new Error('worker unavailable')
    const runtimeDefinitions: WorkerDefinition[] = [
      { queueName: 'email', load: vi.fn(() => Promise.reject(failure)) },
    ]

    await expect(loadWorkers(runtimeDefinitions, 'email')).rejects.toThrow(failure)
  })

  it('tolerates an unknown selection with its default reporter', async () => {
    await expect(loadWorkers(definitions(), 'new-queue')).resolves.toEqual([])
  })
})
