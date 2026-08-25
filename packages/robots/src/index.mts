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
  return delay === undefined ? null : Math.ceil(delay * 1000)
}

async function getRobots(robotsUrl: string, options: RobotsOptions): Promise<string> {
  const cached = await options.cache?.get(robotsUrl)
  if (cached !== undefined) return cached
  const response = await options.transport.fetch(robotsUrl)
  const maxBytes = options.maxResponseSizeBytes ?? 512 * 1024
  const content = response.ok ? await responseText(response, maxBytes) : allowAll
  if (options.cache) await options.cache.set(robotsUrl, content, options.ttlMs ?? 86_400_000)
  return content
}

async function responseText(response: Response, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new TypeError('maxResponseSizeBytes must be a positive safe integer')
  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength > maxBytes) return allowAll
  return new TextDecoder().decode(body)
}
