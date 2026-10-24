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
  const consumers = await Promise.all(
    selectedSqsConsumerDefinitions(definitions, queues).map((definition) => definition.load()),
  )
  return consumers.filter((consumer) => consumer != null)
}
