import { type AdmissionLockManager, withAdmissionAllocationLock } from './admission-lock.mts'
import { ADMISSION_OWNER_LEASE_MS } from './admission-owner-leases.mts'
import type { AdmissionStoredEntry } from './admission-storage-entry.mts'
import type { AdmissionEntryStore } from './admission-storage.mts'

const ADMISSION_OWNER_RENEWAL_MS = ADMISSION_OWNER_LEASE_MS / 3

type OwnerRenewalOptions = {
  entry: Pick<AdmissionStoredEntry, 'intentFingerprint' | 'key'>
  lockManager: AdmissionLockManager | null
  namespace: string
  onError: (error: unknown) => void
  ownerId: string
  storageKey: string
  store: AdmissionEntryStore
}

/** Renews this tab's owner lease while a durable request is in flight. Returns a stop function. */
export function startAdmissionOwnerLeaseRenewal(options: OwnerRenewalOptions): () => void {
  const lockManager = options.lockManager
  if (!lockManager || !options.store.isDurableKey(options.storageKey)) return () => undefined
  let active = true
  let timeout: ReturnType<typeof setTimeout>
  const schedule = (callback: () => Promise<void>) => {
    timeout = setTimeout(() => {
      callback().catch(options.onError)
    }, ADMISSION_OWNER_RENEWAL_MS)
  }
  const renew = async () => {
    try {
      await withAdmissionAllocationLock(options.namespace, options.storageKey, lockManager, () => {
        if (!active) return
        const current = options.store.get(options.storageKey, options.entry.intentFingerprint)
        if (current?.key === options.entry.key) {
          options.store.renew(options.storageKey, current, options.ownerId)
        }
      })
    } finally {
      if (active) schedule(renew)
    }
  }
  schedule(renew)
  return () => {
    active = false
    clearTimeout(timeout)
  }
}
