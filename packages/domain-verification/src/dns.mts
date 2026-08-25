export interface DnsClock {
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
}

export interface DnsTxtResolverOptions {
  lookup: (hostname: string) => Promise<string[][]>
  timeoutMs?: number
  retries?: number
  clock?: DnsClock
}

export class DnsTxtLookupError extends Error {
  constructor(message = 'DNS TXT lookup failed', options?: ErrorOptions) {
    super(message, options)
    this.name = 'DnsTxtLookupError'
  }
}

export class DnsTimeoutError extends DnsTxtLookupError {
  constructor(options?: ErrorOptions) {
    super('DNS TXT lookup timed out', options)
    this.name = 'DnsTimeoutError'
  }
}

const systemClock: DnsClock = { setTimeout, clearTimeout }

export async function resolveTxtRecords(
  hostname: string,
  options: DnsTxtResolverOptions,
): Promise<string[]> {
  const timeoutMs = positiveInteger(options.timeoutMs, 5_000)
  const retries = nonNegativeInteger(options.retries, 2)
  const { lookup } = options
  const clock = options.clock ?? systemClock
  let failure: Error = new DnsTxtLookupError()
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return (await withTimeout(lookup(hostname), timeoutMs, clock)).flat()
    } catch (error) {
      failure = toError(error)
      if (!(failure instanceof DnsTimeoutError)) throw failure
    }
  }
  throw failure
}

export async function hasDnsTxtRecord(
  hostname: string,
  expectedRecord: string,
  options: DnsTxtResolverOptions,
): Promise<boolean> {
  return (await resolveTxtRecords(hostname, options)).includes(expectedRecord)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, clock: DnsClock): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = clock.setTimeout(() => reject(new DnsTimeoutError()), timeoutMs)
    void promise.then(
      (value) => {
        clock.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clock.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError('Expected a positive safe integer')
  return value
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError('Expected a non-negative safe integer')
  return value
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new DnsTxtLookupError(String(error))
}
