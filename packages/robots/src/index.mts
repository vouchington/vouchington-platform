import robotsParser from 'robots-parser'

const allowAll = 'User-agent: *\nAllow: /'
const disallowAll = 'User-agent: *\nDisallow: /'

export interface ParsedRobots {
  isAllowed(url: string, userAgent?: string): boolean | undefined
  getCrawlDelay(userAgent?: string): number | undefined
}

type RobotsParserFactory = (url: string, rules: string) => unknown
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
  /** Overrides RFC 9309 status fallback rules and whether the result enters the caller cache. */
  statusFallback?: (
    status: number,
  ) => { rules: string; cache?: boolean } | Promise<{ rules: string; cache?: boolean }>
}

/** Reads robots.txt, with an optional caller-owned cache, and applies the selected user-agent rules. */
export async function isUrlAllowed(
  url: string,
  userAgent: string,
  options: RobotsOptions,
): Promise<boolean> {
  const robotsUrl = new URL('/robots.txt', url).toString()
  const rules = await getRobots(robotsUrl, options)
  return parseRobotsTxt(robotsUrl, rules).isAllowed(url, userAgent) !== false
}

/** Returns the crawl delay in milliseconds, or null when none applies. */
export async function getCrawlDelayMs(
  url: string,
  userAgent: string,
  options: RobotsOptions,
): Promise<number | null> {
  const robotsUrl = new URL('/robots.txt', url).toString()
  const delay = parseRobotsTxt(robotsUrl, await getRobots(robotsUrl, options)).getCrawlDelay(
    userAgent,
  )
  return getCrawlDelayMilliseconds(delay)
}

/** Parses robots.txt rules while preserving the parser's raw allow/deny result. */
export function parseRobotsTxt(url: string, rules: string | null): ParsedRobots {
  if (typeof robotsParser !== 'function') {
    throw new TypeError('robots-parser module must export a callable parser')
  }
  const parser = (robotsParser as unknown as RobotsParserFactory)(url, rules ?? '')
  if (typeof parser !== 'object' || parser === null) {
    throw new TypeError('robots-parser must return an object')
  }
  if (typeof Reflect.get(parser, 'isAllowed') !== 'function') {
    throw new TypeError('robots-parser result must provide isAllowed()')
  }
  if (typeof Reflect.get(parser, 'getCrawlDelay') !== 'function') {
    throw new TypeError('robots-parser result must provide getCrawlDelay()')
  }
  return parser as ParsedRobots
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
  const result = response.ok
    ? { rules: await responseText(response, maxBytes), cache: true }
    : await statusRules(response, options)
  if (result.rules === null) return allowAll
  if (result.cache !== false)
    await options.cache?.set(robotsUrl, result.rules, options.ttlMs ?? 86_400_000)
  return result.rules
}

async function responseText(response: Response, maxBytes: number): Promise<string | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new TypeError('maxResponseSizeBytes must be a positive safe integer')
  const body = await readResponseBody(response, maxBytes)
  if (body === null) return null
  return new TextDecoder().decode(body)
}

async function statusRules(
  response: Response,
  options: RobotsOptions,
): Promise<{ rules: string; cache?: boolean }> {
  try {
    await response.body?.cancel()
  } catch {
    // Cleanup must not replace the status-derived result.
  }
  return options.statusFallback
    ? await options.statusFallback(response.status)
    : { rules: response.status >= 500 && response.status <= 599 ? disallowAll : allowAll }
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
        try {
          await reader.cancel()
        } catch {
          // Cleanup must not replace the bounded fail-open result.
        }
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
