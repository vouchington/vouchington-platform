export interface WebPushBinding {
  endpoint: string
  subscription_id: string
}

export type WebPushWorkerState =
  | { status: 'uninitialized' }
  | { status: 'bound'; binding: WebPushBinding; revision: string }
  | { status: 'reconciling'; binding?: WebPushBinding; revision: string }
  | { status: 'disabled'; binding?: WebPushBinding; revision: string }

export interface WebPushWorkerResponse {
  type: string
  version: 1
  ok: boolean
  state?: unknown
  error?: string
}

export interface WorkerRequestOptions {
  /** Caller-owned message `type` tag shared with the service worker. */
  messageType: string
  /** Caller-owned check that the acknowledged state is the one the request expects. */
  accept?: (state: WebPushWorkerState) => boolean
  timeoutMs?: number
}

const DEFAULT_ACK_TIMEOUT_MS = 5000

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isWebPushBinding(value: unknown): value is WebPushBinding {
  if (!value || typeof value !== 'object') return false
  const binding = value as { endpoint?: unknown; subscription_id?: unknown }
  return isNonEmptyString(binding.endpoint) && isNonEmptyString(binding.subscription_id)
}

export function isWebPushWorkerState(value: unknown): value is WebPushWorkerState {
  if (!value || typeof value !== 'object') return false
  const state = value as { status?: unknown; binding?: unknown; revision?: unknown }
  if (state.status === 'uninitialized') return state.binding === undefined
  if (state.status === 'bound') {
    return isWebPushBinding(state.binding) && isNonEmptyString(state.revision)
  }
  return (
    (state.status === 'reconciling' || state.status === 'disabled') &&
    isNonEmptyString(state.revision) &&
    (state.binding === undefined || isWebPushBinding(state.binding))
  )
}

/** Envelope check only: tag, version, `ok`, and a well-formed state. */
export function isWebPushWorkerResponse(
  response: WebPushWorkerResponse | undefined,
  messageType: string,
): response is WebPushWorkerResponse & { state: WebPushWorkerState } {
  return (
    !!response &&
    response.type === messageType &&
    response.version === 1 &&
    response.ok === true &&
    isWebPushWorkerState(response.state)
  )
}

/**
 * One request/acknowledge round trip over a MessageChannel to the active service worker.
 * `request` is sent as `{ ...request, type, version: 1 }`; the envelope keys always win. Which requests to send, in what
 * order, and which acknowledged states are acceptable belong to the caller.
 */
export function requestWorkerState(
  registration: { active: { postMessage(message: unknown, transfer: unknown[]): void } | null },
  request: Record<string, unknown>,
  options: WorkerRequestOptions,
): Promise<WebPushWorkerState> {
  const worker = registration.active
  if (!worker) return Promise.reject(new Error('The active service worker is unavailable.'))
  const channel = new MessageChannel()
  return new Promise<WebPushWorkerState>((resolve, reject) => {
    const timeout = setTimeout(() => {
      channel.port1.close()
      reject(new Error('The service worker did not acknowledge the push binding request.'))
    }, options.timeoutMs ?? DEFAULT_ACK_TIMEOUT_MS)
    channel.port1.onmessage = (event: MessageEvent) => {
      clearTimeout(timeout)
      channel.port1.close()
      const response = event.data as WebPushWorkerResponse | undefined
      try {
        if (
          !isWebPushWorkerResponse(response, options.messageType) ||
          (options.accept && !options.accept(response.state))
        ) {
          reject(
            new Error(response?.error ?? 'The service worker rejected the push binding request.'),
          )
          return
        }
        resolve(response.state)
      } catch (error) {
        reject(error)
      }
    }
    worker.postMessage({ ...request, type: options.messageType, version: 1 }, [channel.port2])
  })
}

/** Runs `operation` under a named Web Lock; throws when the browser has no lock manager. */
export async function withWebLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const lockManager = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!lockManager) throw new Error('This browser cannot safely coordinate push notifications.')
  return lockManager.request(name, operation)
}
