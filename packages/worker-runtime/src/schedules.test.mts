import { describe, expect, it, vi } from 'vitest'

import { upsertSchedules, type ScheduleDefinition } from './schedules.mts'

function definition(
  queueName: string,
  alwaysRun = false,
): {
  definition: ScheduleDefinition
  upsert: ReturnType<typeof vi.fn>
} {
  const upsert = vi.fn(() => Promise.resolve())
  return {
    definition: {
      queueName,
      ...(alwaysRun ? { alwaysRun } : {}),
      load: vi.fn(() => Promise.resolve(upsert)),
    },
    upsert,
  }
}

describe('upsertSchedules', () => {
  it('loads and upserts only selected schedules', async () => {
    const email = definition('email')
    const images = definition('images')

    await upsertSchedules([email.definition, images.definition], 'email')

    expect(email.definition.load).toHaveBeenCalledOnce()
    expect(images.definition.load).not.toHaveBeenCalled()
    expect(email.upsert).toHaveBeenCalledOnce()
  })

  it('runs all schedules when selection is absent and drops unrelated queue names', async () => {
    const email = definition('email')
    const images = definition('images')

    await upsertSchedules([email.definition, images.definition], undefined)
    await upsertSchedules([email.definition, images.definition], 'sibling-runtime')

    expect(email.definition.load).toHaveBeenCalledOnce()
    expect(images.definition.load).toHaveBeenCalledOnce()
  })

  it('runs generic alwaysRun schedules regardless of the selected queue', async () => {
    const maintenance = definition('maintenance', true)

    await upsertSchedules([maintenance.definition], 'email')

    expect(maintenance.definition.load).toHaveBeenCalledOnce()
  })

  it('propagates loader and upsert failures', async () => {
    const loaderFailure = new Error('loader unavailable')
    const upsertFailure = new Error('upsert unavailable')
    const loaders: ScheduleDefinition[] = [
      { queueName: 'loader', load: vi.fn(() => Promise.reject(loaderFailure)) },
      {
        queueName: 'upsert',
        load: vi.fn(() => Promise.resolve(() => Promise.reject(upsertFailure))),
      },
    ]

    await expect(upsertSchedules([loaders[0]!], 'loader')).rejects.toThrow(loaderFailure)
    await expect(upsertSchedules([loaders[1]!], 'upsert')).rejects.toThrow(upsertFailure)
  })
})
