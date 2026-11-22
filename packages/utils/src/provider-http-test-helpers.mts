import type { ProviderFetch, ProviderRequestInit } from './provider-http.mts'

export interface RecordedCall {
  input: string
  init: ProviderRequestInit
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

/** Fake transport that records calls and answers with `respond`. */
export function fakeFetch(respond: () => Response | Promise<Response>): {
  fetch: ProviderFetch
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ input, init })
      return respond()
    },
  }
}
