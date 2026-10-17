import { CLOUDFLARE_API_ROOT, readCloudflareEnvelope } from './cloudflare-api.mts'

interface WorkerScript {
  id: string
}

interface WorkerBinding {
  type?: string
  namespace_id?: string
}

export interface RateLimitNamespaceCollision {
  script: string
  namespaceId: string
}

async function listWorkerScripts(
  accountId: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<WorkerScript[]> {
  const scripts: WorkerScript[] = []
  let page = 1
  let totalPages = 1
  do {
    const url = `${CLOUDFLARE_API_ROOT}/accounts/${accountId}/workers/scripts?page=${page}&per_page=100`
    // oxlint-disable-next-line no-await-in-loop -- each response supplies the total-page bound required before requesting the next page
    const envelope = await readCloudflareEnvelope<WorkerScript[]>(await fetchImpl(url, { headers }))
    scripts.push(...envelope.result)
    totalPages = envelope.result_info?.total_pages ?? page
    page += 1
  } while (page <= totalPages)
  return scripts
}

/**
 * Finds other Workers in the account that bind any of the desired rate-limit namespace IDs.
 * Workers sharing a namespace share counters, so a collision silently halves a budget.
 */
export async function findRateLimitNamespaceCollisions(
  accountId: string,
  apiToken: string,
  targetScript: string,
  desiredNamespaceIds: ReadonlySet<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<RateLimitNamespaceCollision[]> {
  const headers = { authorization: `Bearer ${apiToken}` }
  const scripts = await listWorkerScripts(accountId, headers, fetchImpl)
  const settingsByScript = await Promise.all(
    scripts
      .filter((script) => script.id !== targetScript)
      .map(async (script) => ({
        script: script.id,
        settings: (
          await readCloudflareEnvelope<{ bindings?: WorkerBinding[] }>(
            await fetchImpl(
              `${CLOUDFLARE_API_ROOT}/accounts/${accountId}/workers/scripts/${script.id}/settings`,
              { headers },
            ),
          )
        ).result,
      })),
  )

  return settingsByScript.flatMap(({ script, settings }) =>
    (settings.bindings ?? []).flatMap((binding) =>
      binding.type === 'ratelimit' &&
      binding.namespace_id &&
      desiredNamespaceIds.has(binding.namespace_id)
        ? [{ script, namespaceId: binding.namespace_id }]
        : [],
    ),
  )
}

export interface RateLimitNamespaceCollisionCliOptions {
  /** Namespace IDs to verify, typically `process.argv.slice(2)`. */
  args: readonly string[]
  /** The Worker script that owns the namespaces; it is excluded from the scan. */
  targetScript: string
  check?: typeof findRateLimitNamespaceCollisions | undefined
  env: Readonly<Record<string, string | undefined>>
  /** Pass `import.meta.main` so importing the module never runs the check. */
  isMain: boolean
  log(message: string): void
}

/** Command-line wrapper: throws on missing input or any collision, otherwise logs success. */
export async function runRateLimitNamespaceCollisionCli(
  options: RateLimitNamespaceCollisionCliOptions,
): Promise<void> {
  if (!options.isMain) return
  const accountId = options.env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = options.env.CLOUDFLARE_API_TOKEN
  if (!accountId || !apiToken) throw new Error('Cloudflare account credentials are required')
  const desired = new Set(options.args)
  if (desired.size === 0) throw new Error('At least one namespace ID is required')
  const check = options.check ?? findRateLimitNamespaceCollisions
  const collisions = await check(accountId, apiToken, options.targetScript, desired)
  if (collisions.length > 0) {
    throw new Error(`Rate-limit namespace collision: ${JSON.stringify(collisions)}`)
  }
  options.log(`Verified ${desired.size} rate-limit namespace IDs are unused by other Workers`)
}
