import { NodeOAuthClient, type NodeOAuthClientOptions } from '@atproto/oauth-client-node'
import { unicastFetchWrap, type Fetch } from '@atproto-labs/fetch-node'
import { AtprotoHandleResolverNode } from '@atproto-labs/handle-resolver-node'

export interface AtprotoOAuthClientOptions {
  clientMetadata: NodeOAuthClientOptions['clientMetadata']
  keyset: NonNullable<NodeOAuthClientOptions['keyset']>
  stateStore: NodeOAuthClientOptions['stateStore']
  sessionStore: NodeOAuthClientOptions['sessionStore']
  /** Egress-guarded transport; the SDK's token, PAR and discovery requests go through it. */
  fetch: Fetch
  /** Aborts every outbound request in addition to each request's own signal. */
  operationSignal?: AbortSignal
  /** Cross-process lock for session refresh; the SDK falls back to an in-process lock. */
  requestLock?: NodeOAuthClientOptions['requestLock']
}

/**
 * Builds the SDK client. Requests use `unicastFetchWrap` over the injected fetch. The handle
 * resolver adds its own address checks, so it receives the unwrapped fetch and validation
 * happens exactly once.
 */
export function createAtprotoOAuthClient(options: AtprotoOAuthClientOptions): NodeOAuthClient {
  const { operationSignal, fetch: injectedFetch } = options
  const baseFetch: Fetch = async (input, init) => {
    if (!operationSignal) return injectedFetch(input, init)
    // A Request carries its own signal; keep it when init does not override it.
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    return injectedFetch(input, {
      ...init,
      signal: requestSignal ? AbortSignal.any([requestSignal, operationSignal]) : operationSignal,
    })
  }
  return new NodeOAuthClient({
    clientMetadata: options.clientMetadata,
    keyset: options.keyset,
    stateStore: options.stateStore,
    sessionStore: options.sessionStore,
    fetch: unicastFetchWrap({ fetch: baseFetch }),
    handleResolver: new AtprotoHandleResolverNode({ fetch: baseFetch }),
    ...(options.requestLock ? { requestLock: options.requestLock } : {}),
  })
}
