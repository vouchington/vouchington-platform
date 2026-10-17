import type { DataCollection } from '@sentry/core'

/** The SDK's own client-IP header list, plus Cloudflare's pseudo-IPv4. Matched by substring. */
export const CLIENT_IP_HEADER_NAMES: readonly string[] = Object.freeze([
  'x-client-ip',
  'x-forwarded-for',
  'x-forwarded',
  'forwarded-for',
  'forwarded',
  'x-vercel-forwarded-for',
  'x-real-ip',
  'x-cluster-client-ip',
  'true-client-ip',
  'fastly-client-ip',
  'fly-client-ip',
  'cf-connecting-ip',
  'cf-pseudo-ipv4',
])

export interface DataCollectionOptions {
  /**
   * Request header names the SDK must not copy onto events and spans. Inject the application's
   * credential headers here; the client-IP headers are always included.
   */
  credentialHeaders?: readonly string[]
}

/**
 * Least-data `dataCollection` policy (Sentry v11 collects everything by default): no client IP,
 * cookies, query strings, bodies, database values, stack locals, queue arguments, GraphQL
 * documents, or gen-AI content. Returns a fresh object because the SDK keeps the arrays it gets.
 */
export function createDataCollectionPolicy(options: DataCollectionOptions = {}): DataCollection {
  const deny = [...new Set([...CLIENT_IP_HEADER_NAMES, ...(options.credentialHeaders ?? [])])]
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { deny } },
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    stackFrameVariables: false,
    queues: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
  } as DataCollection
}
