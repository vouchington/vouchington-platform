export class ServiceWorkerActivationTimeoutError extends Error {
  constructor() {
    super('Timed out waiting for the service worker to activate.')
    this.name = 'ServiceWorkerActivationTimeoutError'
  }
}

export interface WaitForActiveServiceWorkerOptions {
  timeoutMs?: number
  /** Defaults to navigator.serviceWorker; injectable for tests. */
  serviceWorker?: ServiceWorkerContainer
}

declare global {
  interface ServiceWorker extends EventTarget {
    readonly state: 'parsed' | 'installing' | 'installed' | 'activating' | 'activated' | 'redundant'
  }

  interface ServiceWorkerRegistration {
    readonly active: ServiceWorker | null
    readonly installing: ServiceWorker | null
    readonly waiting: ServiceWorker | null
  }

  interface ServiceWorkerContainer {
    readonly ready: Promise<ServiceWorkerRegistration>
  }

  interface Navigator {
    readonly serviceWorker: ServiceWorkerContainer
  }
}

/** Resolves when `registration` has an active worker. Pass `timeoutMs` to bound the wait. */
export function waitForActiveServiceWorker(
  registration: ServiceWorkerRegistration,
  options: WaitForActiveServiceWorkerOptions = {},
): Promise<ServiceWorkerRegistration> {
  const replacement = registration.installing ?? registration.waiting
  if (!replacement) {
    if (registration.active) return Promise.resolve(registration)
    const container = options.serviceWorker ?? navigator.serviceWorker
    return waitWithOptionalTimeout(container.ready, options.timeoutMs)
  }
  if (replacement.state === 'activated') return Promise.resolve(registration)
  return waitForReplacement(registration, replacement, options.timeoutMs)
}

function waitForReplacement(
  registration: ServiceWorkerRegistration,
  worker: ServiceWorker,
  timeoutMs: number | undefined,
): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const timeout =
      timeoutMs === undefined
        ? undefined
        : setTimeout(
            () => finish(() => reject(new ServiceWorkerActivationTimeoutError())),
            timeoutMs,
          )

    function finish(settle: () => void) {
      worker.removeEventListener('statechange', onStateChange)
      if (timeout !== undefined) clearTimeout(timeout)
      settle()
    }

    function onStateChange() {
      if (worker.state === 'activated') finish(() => resolve(registration))
      else if (worker.state === 'redundant') {
        finish(() => reject(new Error('Service worker replacement became redundant.')))
      }
    }

    worker.addEventListener('statechange', onStateChange)
    onStateChange()
  })
}

function waitWithOptionalTimeout(
  ready: Promise<ServiceWorkerRegistration>,
  timeoutMs: number | undefined,
): Promise<ServiceWorkerRegistration> {
  if (timeoutMs === undefined) return ready
  let timeout: ReturnType<typeof setTimeout>
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new ServiceWorkerActivationTimeoutError()), timeoutMs)
  })
  return Promise.race([ready, timedOut]).finally(() => clearTimeout(timeout))
}
