import { vi } from 'vitest'
import { OAuthProviderError, type OAuthCallContext } from './oauth-providers-core.mts'

export const NOW = 1_700_000_000_000

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

type Route = Response | (() => Response)

/** A fetch double that answers by URL prefix and records every call. */
export function routeFetch(routes: Record<string, Route>) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix))
    if (!key) throw new Error(`Unexpected request: ${url}`)
    const route = routes[key]!
    if (typeof route === 'function') return route()
    // A fresh response per call: a tee'd clone cannot be cancelled while the original is unread.
    return new Response(await route.clone().text(), { status: route.status })
  })
  const ctx = (extra: Partial<OAuthCallContext> = {}): OAuthCallContext => ({
    fetch,
    now: () => NOW,
    ...extra,
  })
  const init = (index: number) => fetch.mock.calls[index]![1]!
  return { fetch, ctx, init, urls: () => fetch.mock.calls.map((call) => call[0]) }
}

export async function failure(promise: Promise<unknown>): Promise<OAuthProviderError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!(error instanceof OAuthProviderError)) throw new Error('Expected an OAuthProviderError')
  return error
}

/** Decodes a form-encoded request body. */
export const form = (init: RequestInit) =>
  Object.fromEntries(new URLSearchParams(init.body as string))

export const input = {
  code: 'auth-code',
  redirectUri: 'https://app.example.com/callback',
  codeVerifier: 'verifier-1',
}
