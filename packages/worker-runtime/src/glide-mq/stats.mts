import type { Queue } from 'glide-mq'

export interface QueueStats {
  name: string
  waiting: number
  active: number
  delayed: number
  completed: number
  failed: number
  paused: boolean
}

export interface AggregatedQueueStats {
  totalWaiting: number
  totalActive: number
  totalDelayed: number
  totalCompleted: number
  totalFailed: number
  queueCount: number
}

export type StatsQueue = Pick<Queue, 'getJobCounts' | 'isPaused'>

/** Reads job counts and paused state with two concurrent calls. `delayed` is the scheduled set. */
export async function getQueueStats(queue: StatsQueue, name: string): Promise<QueueStats> {
  const [counts, paused] = await Promise.all([queue.getJobCounts(), queue.isPaused()])
  return {
    name,
    waiting: counts.waiting,
    active: counts.active,
    delayed: counts.delayed,
    completed: counts.completed,
    failed: counts.failed,
    paused,
  }
}

/** Reads stats for several queues, sorted by name. */
export async function getAllQueueStats(
  queues: readonly { name: string; queue: StatsQueue }[],
): Promise<QueueStats[]> {
  const stats = await Promise.all(queues.map(({ name, queue }) => getQueueStats(queue, name)))
  return stats.toSorted((a, b) => a.name.localeCompare(b.name))
}

export function aggregateQueueStats(stats: readonly QueueStats[]): AggregatedQueueStats {
  return stats.reduce<AggregatedQueueStats>(
    (total, queue) => ({
      totalWaiting: total.totalWaiting + queue.waiting,
      totalActive: total.totalActive + queue.active,
      totalDelayed: total.totalDelayed + queue.delayed,
      totalCompleted: total.totalCompleted + queue.completed,
      totalFailed: total.totalFailed + queue.failed,
      queueCount: total.queueCount + 1,
    }),
    {
      totalWaiting: 0,
      totalActive: 0,
      totalDelayed: 0,
      totalCompleted: 0,
      totalFailed: 0,
      queueCount: 0,
    },
  )
}
