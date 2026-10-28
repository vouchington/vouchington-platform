import type { Worker } from 'glide-mq'
import { scheduler } from 'node:timers/promises'

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

export async function loadWorkers(
  definitions: readonly WorkerDefinition[],
  queues = process.env.QUEUES,
  onUnknownIncludes: UnknownQueueReporter = () => undefined,
  queueNamesOwnedByOtherRuntimes: readonly string[] = [],
): Promise<Worker[]> {
  const selected = selectedWorkerDefinitions(
    definitions,
    queues,
    onUnknownIncludes,
    queueNamesOwnedByOtherRuntimes,
  )
  const pending: Promise<Worker>[] = []

  for (const [index, definition] of selected.entries()) {
    const load = definition.load()
    // Promise.all attaches after the yields. Handle a fast rejection immediately so Node does not
    // report it as unhandled while later worker imports are being started.
    void load.catch(() => undefined)
    pending.push(load)
    if (index < selected.length - 1) await scheduler.yield()
  }

  return Promise.all(pending)
}
