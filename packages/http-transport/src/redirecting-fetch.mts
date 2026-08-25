export type UndiciFetchInit = RequestInit

export type UndiciCompatibleFetch = (url: URL, init?: UndiciFetchInit) => Promise<Response>

export interface ResolvedHttpDestination {
  dispatcher?: RequestInit['dispatcher']
}

export type ResolveHttpDestination = (
  url: URL,
  signal: AbortSignal | null | undefined,
) => Promise<ResolvedHttpDestination> | ResolvedHttpDestination

export interface RedirectingFetchOptions {
  fetch: UndiciCompatibleFetch
  resolveDestination: ResolveHttpDestination
  maxRedirects?: number
}

export class RedirectFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RedirectFetchError'
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export function createRedirectingFetch(options: RedirectingFetchOptions) {
  const maxRedirects = options.maxRedirects ?? 10
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new RangeError('maxRedirects must be a non-negative safe integer')
  }

  return async function redirectingFetch(input: URL | string, init: UndiciFetchInit = {}) {
    rejectUnsafeRequestInit(init)
    let url = parseHttpUrl(input)

    for (let redirects = 0; ; redirects += 1) {
      const destination = await options.resolveDestination(url, init.signal)
      const response = await options.fetch(url, {
        ...init,
        ...(destination.dispatcher === undefined ? {} : { dispatcher: destination.dispatcher }),
        redirect: 'manual',
      })
      if (!REDIRECT_STATUSES.has(response.status)) return response

      const location = response.headers.get('location')
      void response.body?.cancel()
      if (location === null)
        throw new RedirectFetchError('Redirect response has no Location header')
      if (redirects >= maxRedirects)
        throw new RedirectFetchError(`Exceeded ${maxRedirects} redirects`)
      url = parseHttpUrl(new URL(location, url))
    }
  }
}

function rejectUnsafeRequestInit(init: UndiciFetchInit): void {
  if (init.redirect !== undefined && init.redirect !== 'manual') {
    throw new RedirectFetchError('redirect must be omitted or manual')
  }
  if (
    init.body !== undefined ||
    (init.method !== undefined && !/^(GET|HEAD)$/i.test(init.method))
  ) {
    throw new RedirectFetchError(
      'Redirecting fetch accepts only GET and HEAD requests without a body',
    )
  }
}

function parseHttpUrl(input: URL | string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new RedirectFetchError('Invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RedirectFetchError('URL protocol must be HTTP or HTTPS')
  }
  return url
}
