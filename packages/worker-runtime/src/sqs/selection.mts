import { isQueueSelected, parseQueueSelection } from '../queue-selection.mts'
import type { SqsConsumer, SqsConsumerDefinition } from './types.mts'

/**
 * Selects consumer definitions from the process's resolved queue selection. The selection is
 * shared with other runtimes, so names that are not consumers are expected and ignored.
 */
export function selectedSqsConsumerDefinitions<D extends SqsConsumerDefinition>(
  definitions: readonly D[],
  queues: string | undefined,
): D[] {
  const selection = parseQueueSelection(
    queues,
    definitions.map((definition) => definition.queueName),
    { dropUnknownIncludes: true },
  )
  return definitions.filter((definition) => {
    if (definition.requiresExplicitInclusion && selection.mode !== 'include') return false
    return isQueueSelected(selection, definition.queueName)
  })
}

/** Loads the selected consumers, dropping definitions whose `load()` resolves null. */
export async function loadSqsConsumers(
  definitions: readonly SqsConsumerDefinition[],
  queues: string | undefined,
): Promise<SqsConsumer[]> {
  // Consumers start polling when created, so wait for every load and close the ones that
  // succeeded if another fails.
  const outcomes = await Promise.allSettled(
    selectedSqsConsumerDefinitions(definitions, queues).map((definition) => definition.load()),
  )
  const loaded = outcomes.flatMap((outcome) =>
    outcome.status === 'fulfilled' && outcome.value != null ? [outcome.value] : [],
  )
  const failure = outcomes.find((outcome) => outcome.status === 'rejected')
  if (failure) {
    await Promise.allSettled(loaded.map((consumer) => consumer.close()))
    throw failure.reason
  }
  return loaded
}
