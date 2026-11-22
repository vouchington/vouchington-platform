/** The slice of a standalone GlideMQ command client terminal removal needs. */
export interface TerminalJobRemovalClient {
  watch(keys: string[]): Promise<unknown>
  unwatch(): Promise<unknown>
  hget(key: string, field: string): Promise<unknown>
  /**
   * Runs `glidemq_removeJob(keys, args)` in one atomic transaction (for example
   * `exec(new Batch(true).fcall(name, keys, args), true)`), resolving `null` when a WATCHed key
   * changed and otherwise the function's replies.
   */
  removeJob(keys: string[], args: string[]): Promise<readonly unknown[] | null>
}

/** Hold WATCH on one dedicated connection until native removal or explicit release. */
export async function acquireTerminalJobRemoval(
  client: TerminalJobRemovalClient,
  namespace: string,
  jobId: string,
) {
  const jobKey = `${namespace}:job:${jobId}`
  await client.watch([jobKey])
  let watched = true
  const release = async () => {
    if (!watched) return
    await client.unwatch()
    watched = false
  }
  let state: unknown
  try {
    state = await client.hget(jobKey, 'state')
  } catch (error) {
    // The WATCH is held on this connection; drop it before the failure escapes.
    await release().catch(() => {})
    throw error
  }
  if (state === null) return { state: 'missing' as const, release }
  if (state !== 'completed' && state !== 'failed') return { state: 'live' as const, release }

  return {
    state: 'terminal' as const,
    terminalState: state,
    release,
    // The caller may preserve page checkpoints while this hash is still WATCHed.
    readData: () => client.hget(jobKey, 'data'),
    async remove(): Promise<boolean> {
      const result = await client.removeJob(
        [
          jobKey,
          `${namespace}:stream`,
          `${namespace}:scheduled`,
          `${namespace}:completed`,
          `${namespace}:failed`,
          `${namespace}:events`,
          `${namespace}:log:${jobId}`,
        ],
        [jobId],
      )
      watched = false
      // A concurrent retry changes the watched hash, so null means no removal on this pass.
      // Native removal leaves cross-queue parent notifications in xq-pending for its scheduler.
      return result !== null && result[0] !== 0
    },
  }
}
