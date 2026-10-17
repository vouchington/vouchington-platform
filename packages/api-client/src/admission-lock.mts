export type AdmissionLockManager = {
  request<T>(name: string, callback: () => Promise<T> | T): Promise<T>
}

/** Key prefix for durable (browser-storage-backed) admission entries in an application namespace. */
export function admissionStoragePrefix(namespace: string): string {
  return `${namespace}:admission-idempotency:v1:`
}

/** Serializes durable storage allocation across tabs; memory-only keys run unlocked. */
export async function withAdmissionAllocationLock<T>(
  namespace: string,
  storageKey: string,
  lockManager: AdmissionLockManager | null,
  callback: () => Promise<T> | T,
): Promise<T> {
  if (!storageKey.startsWith(admissionStoragePrefix(namespace))) return callback()
  if (!lockManager) throw new Error('Durable admission requires browser Web Locks support')
  return lockManager.request(`${namespace}:admission-storage:v1`, () =>
    lockManager.request(`${namespace}:admission-allocation:${storageKey}`, callback),
  )
}

export function getActiveAdmissionStorageKeys(
  entries: ReadonlyMap<string, { inFlight?: Promise<unknown> | undefined }>,
): Set<string> {
  const activeStorageKeys = new Set<string>()
  for (const [key, entry] of entries) {
    if (entry.inFlight) activeStorageKeys.add(key)
  }
  return activeStorageKeys
}

export function getAdmissionLockManager(): AdmissionLockManager | null {
  try {
    const navigator = (globalThis as { navigator?: { locks?: AdmissionLockManager } }).navigator
    return navigator?.locks ?? null
  } catch {
    return null
  }
}
