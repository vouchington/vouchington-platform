import { describe, expect, it, vi } from 'vitest'

import { loadSqsConsumers, selectedSqsConsumerDefinitions } from './selection.mts'
import type { SqsConsumer, SqsConsumerDefinition } from './types.mts'

const consumer = (name: string) => ({ name }) as unknown as SqsConsumer
const definition = (
  queueName: string,
  options: Partial<SqsConsumerDefinition> = {},
): SqsConsumerDefinition => ({
  queueName,
  load: vi.fn(async () => consumer(queueName)),
  ...options,
})

describe('selectedSqsConsumerDefinitions', () => {
  const definitions = [definition('a'), definition('b', { requiresExplicitInclusion: true })]

  it('skips explicit-inclusion consumers unless an include list names them', () => {
    expect(selectedSqsConsumerDefinitions(definitions, undefined).map((d) => d.queueName)).toEqual([
      'a',
    ])
    expect(selectedSqsConsumerDefinitions(definitions, '-a').map((d) => d.queueName)).toEqual([])
    expect(selectedSqsConsumerDefinitions(definitions, 'b').map((d) => d.queueName)).toEqual(['b'])
  })

  it('ignores selected names owned by other runtimes', () => {
    expect(selectedSqsConsumerDefinitions(definitions, 'a,emails').map((d) => d.queueName)).toEqual(
      ['a'],
    )
  })
})

describe('loadSqsConsumers', () => {
  it('loads only the selected consumers', async () => {
    const definitions = [definition('a'), definition('b')]

    const consumers = await loadSqsConsumers(definitions, 'a')

    expect(consumers).toEqual([{ name: 'a' }])
    expect(definitions[1]!.load).not.toHaveBeenCalled()
  })

  it('drops definitions whose load resolves null', async () => {
    const definitions = [definition('a', { load: async () => null }), definition('b')]

    await expect(loadSqsConsumers(definitions, undefined)).resolves.toEqual([{ name: 'b' }])
  })
})
