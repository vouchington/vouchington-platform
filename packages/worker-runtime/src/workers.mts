import type { Worker } from 'glide-mq'

import { isQueueSelected, parseQueueSelection } from './queue-selection.mts'

export interface WorkerDefinition {
  queueName: string
  load: () => Promise<Worker>
  requiresExplicitInclusion?: boolean
}

export type UnknownQueueReporter = (unknownQueueNames: readonly string[]) => void

export function selectedWorkerDefinitions(
  definitions: readonly WorkerDefinition[],
  queues = process.env.QUEUES,
  onUnknownIncludes: UnknownQueueReporter = () => undefined,
  queueNamesOwnedByOtherRuntimes: readonly string[] = [],
): WorkerDefinition[] {
  const knownQueueNames = [
    ...definitions.map((definition) => definition.queueName),
    ...queueNamesOwnedByOtherRuntimes,
  ]
  const selection = parseQueueSelection(queues, knownQueueNames, {
    dropUnknownIncludes: true,
    onUnknownIncludes,
  })
  return definitions.filter((definition) => {
    if (definition.requiresExplicitInclusion && selection.mode !== 'include') return false
    return isQueueSelected(selection, definition.queueName)
  })
}

export function loadWorkers(
  definitions: readonly WorkerDefinition[],
  queues = process.env.QUEUES,
  onUnknownIncludes: UnknownQueueReporter = () => undefined,
  queueNamesOwnedByOtherRuntimes: readonly string[] = [],
): Promise<Worker[]> {
  return Promise.all(
    selectedWorkerDefinitions(
      definitions,
      queues,
      onUnknownIncludes,
      queueNamesOwnedByOtherRuntimes,
    ).map((definition) => definition.load()),
  )
}
