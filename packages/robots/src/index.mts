import robotsParser from 'robots-parser'

const allowAll = 'User-agent: *\nAllow: /'
type RobotsParser = (
  url: string,
  rules: string,
) => {
  isAllowed(url: string, userAgent: string): boolean | undefined
  getCrawlDelay(userAgent: string): number | undefined
}
const parseRobots = robotsParser as unknown as RobotsParser
const inFlight = new WeakMap<RobotsOptions, Map<string, Promise<string>>>()

export interface RobotsTransport {
  fetch(url: string): Promise<Response>
}

export interface RobotsCache {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string, ttlMs: number): Promise<void>
}

export interface RobotsOptions {
  transport: RobotsTransport
  cache?: RobotsCache
  ttlMs?: number
  maxResponseSizeBytes?: number
}

/** Reads robots.txt, with an optional caller-owned cache, and applies the selected user-agent rules. */
export async function isUrlAllowed(
  url: string,
  userAgent: string,
  options: RobotsOptions,
): Promise<boolean> {
  const robotsUrl = new URL('/robots.txt', url).toString()
  const rules = await getRobots(robotsUrl, options)
  return parseRobots(robotsUrl, rules).isAllowed(url, userAgent) !== false
}

/** Returns the crawl delay in milliseconds, or null when none applies. */
export async function getCrawlDelayMs(
  url: string,
  userAgent: string,
  options: RobotsOptions,
): Promise<number | null> {
  const robotsUrl = new URL('/robots.txt', url).toString()
  const delay = parseRobots(robotsUrl, await getRobots(robotsUrl, options)).getCrawlDelay(userAgent)
  return getCrawlDelayMilliseconds(delay)
}

/** Converts a robots Crawl-delay (seconds) to milliseconds when it is usable. */
export function getCrawlDelayMilliseconds(delay: number | undefined): number | null {
  if (delay === undefined || !Number.isFinite(delay) || delay < 0) return null
  return Math.ceil(delay * 1000)
}

async function getRobots(robotsUrl: string, options: RobotsOptions): Promise<string> {
  const cached = await options.cache?.get(robotsUrl)
  if (cached !== undefined) return cached
  let pending = inFlight.get(options)
  if (!pending) {
    pending = new Map()
    inFlight.set(options, pending)
  }
  const existing = pending.get(robotsUrl)
  if (existing) return await existing
  const work = fetchRobots(robotsUrl, options)
  pending.set(robotsUrl, work)
  try {
    return await work
  } finally {
    pending.delete(robotsUrl)
  }
}

async function fetchRobots(robotsUrl: string, options: RobotsOptions): Promise<string> {
  const response = await options.transport.fetch(robotsUrl)
  const maxBytes = options.maxResponseSizeBytes ?? 512 * 1024
  const content = response.ok
    ? await responseText(response, maxBytes)
    : await unavailableResponse(response)
  const cache = options.cache
  if (cache === undefined) return content
  await cache.set(robotsUrl, content, options.ttlMs ?? 86_400_000)
  return content
}

async function responseText(response: Response, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new TypeError('maxResponseSizeBytes must be a positive safe integer')
  const body = await readResponseBody(response, maxBytes)
  if (body === null) return allowAll
  return new TextDecoder().decode(body)
}

async function unavailableResponse(response: Response): Promise<string> {
  try {
    await response.body?.cancel()
  } catch {
    // Cleanup must not replace the fail-open result.
  }
  return allowAll
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}
