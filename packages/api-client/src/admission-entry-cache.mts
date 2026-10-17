import { getActiveAdmissionStorageKeys } from './admission-lock.mts'
import { ADMISSION_RETENTION_MS } from './admission-storage-entry.mts'
import type { AdmissionEntryStore } from './admission-storage.mts'
import type { AdmissionIdempotencyEntry as Entry } from './admission-types.mts'

/** In-memory admission entries backed by the durable store; entries own their idempotency key. */
export class AdmissionEntryCache {
  readonly entries = new Map<string, Entry>()
  readonly #store: AdmissionEntryStore
  readonly #now: () => number
  readonly #generateKey: () => string

  constructor(store: AdmissionEntryStore, now: () => number, generateKey: () => string) {
    this.#store = store
    this.#now = now
    this.#generateKey = generateKey
  }

  getOrCreate(storageKey: string, intentFingerprint: string): Entry {
    const existing = this.#get(storageKey, intentFingerprint)
    if (existing?.intentFingerprint === intentFingerprint) return existing
    const entry = {
      intentFingerprint,
      key: this.#generateKey(),
      expiresAt: this.#now() + ADMISSION_RETENTION_MS,
      ownerIds: [],
    }
    this.entries.set(storageKey, entry)
    if (
      this.#store.isDurableKey(storageKey) &&
      !this.#store.set(storageKey, entry, getActiveAdmissionStorageKeys(this.entries))
    ) {
      this.entries.delete(storageKey)
      throw new Error('Durable admission requires writable browser storage')
    }
    return entry
  }

  #get(storageKey: string, intentFingerprint: string): Entry | undefined {
    const memoryEntry = this.entries.get(storageKey)
    if (memoryEntry?.inFlight || (memoryEntry && memoryEntry.expiresAt > this.#now()))
      return memoryEntry
    this.entries.delete(storageKey)
    const persisted = this.#store.get(storageKey, intentFingerprint)
    if (!persisted) return undefined
    this.entries.set(storageKey, persisted)
    return persisted
  }
}
