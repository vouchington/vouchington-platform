import { isQueueSelected, parseQueueSelection } from './queue-selection.mts'

export interface ScheduleDefinition {
  queueName: string
  load: () => Promise<() => Promise<void>>
  /** Register this schedule even when queue selection excludes it. */
  alwaysRun?: boolean
}

export async function upsertSchedules(
  definitions: readonly ScheduleDefinition[],
  queues = process.env.QUEUES,
): Promise<void> {
  const selection = parseQueueSelection(
    queues,
    definitions.map((definition) => definition.queueName),
    { dropUnknownIncludes: true },
  )
  await Promise.all(
    definitions
      .filter(
        (definition) => definition.alwaysRun || isQueueSelected(selection, definition.queueName),
      )
      .map(async (definition) => {
        const upsert = await definition.load()
        await upsert()
      }),
  )
}
