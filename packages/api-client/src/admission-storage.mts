import {
  claimAdmissionOwner,
  releaseAdmissionOwner,
  renewAdmissionOwner,
} from './admission-owner-leases.mts'
import { parseStoredAdmissionEntry, type AdmissionStoredEntry } from './admission-storage-entry.mts'

export const MAX_ADMISSION_STORAGE_ENTRIES = 100

/** The subset of the Web Storage API used for durable entries. */
export type AdmissionStorage = {
  readonly length: number
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key(index: number): string | null
}

type StoredAdmissionEntry = {
  storageKey: string
  entry: AdmissionStoredEntry
}

/** Durable entries in browser storage, keyed under a namespaced prefix. Storage is best-effort. */
export class AdmissionEntryStore {
  readonly #storage: AdmissionStorage | null
  readonly #now: () => number
  readonly #prefix: string

  constructor(storage: AdmissionStorage | null, now: () => number, prefix: string) {
    this.#storage = storage
    this.#now = now
    this.#prefix = prefix
  }

  isDurableKey(storageKey: string): boolean {
    return storageKey.startsWith(this.#prefix)
  }

  get(storageKey: string, intentFingerprint: string): AdmissionStoredEntry | undefined {
    if (!this.isDurableKey(storageKey)) return undefined
    try {
      const value = this.#storage?.getItem(storageKey)
      if (!value) return undefined
      const entry = parseStoredAdmissionEntry(value, this.#now(), intentFingerprint)
      if (!entry) {
        this.remove(storageKey)
        return undefined
      }
      return entry
    } catch {
      this.remove(storageKey)
      return undefined
    }
  }

  set(
    storageKey: string,
    entry: AdmissionStoredEntry,
    protectedStorageKeys: ReadonlySet<string> = new Set(),
  ): boolean {
    const storage = this.#storage
    if (!this.isDurableKey(storageKey) || !storage) return false
    try {
      const entries = this.#pruneInvalidEntries(storage)
      const existing = entries.some((candidate) => candidate.storageKey === storageKey)
      const entriesToRemove = entries.length + (existing ? 0 : 1) - MAX_ADMISSION_STORAGE_ENTRIES
      if (entriesToRemove > 0) {
        const candidates = entries
          .filter(
            (candidate) =>
              candidate.storageKey !== storageKey &&
              !protectedStorageKeys.has(candidate.storageKey) &&
              !candidate.entry.retryRequired &&
              Object.keys(candidate.entry.ownerLeases ?? {}).length === 0,
          )
          .toSorted(
            (left, right) =>
              left.entry.expiresAt - right.entry.expiresAt ||
              left.storageKey.localeCompare(right.storageKey),
          )
        if (candidates.length < entriesToRemove) return false
        for (const candidate of candidates.slice(0, entriesToRemove))
          storage.removeItem(candidate.storageKey)
      }
      storage.setItem(storageKey, JSON.stringify({ version: 1, ...entry }))
      return true
    } catch {
      return false
    }
  }

  claim(
    storageKey: string,
    entry: AdmissionStoredEntry,
    ownerId: string,
    protectedStorageKeys: ReadonlySet<string> = new Set(),
  ): boolean {
    return this.set(
      storageKey,
      claimAdmissionOwner(entry, ownerId, this.#now()),
      protectedStorageKeys,
    )
  }

  renew(storageKey: string, entry: AdmissionStoredEntry, ownerId: string): boolean {
    return this.set(storageKey, renewAdmissionOwner(entry, ownerId, this.#now()))
  }

  release(
    storageKey: string,
    entry: AdmissionStoredEntry,
    ownerId: string,
    retryRequired: boolean,
    protectedStorageKeys: ReadonlySet<string> = new Set(),
  ): { entry: AdmissionStoredEntry; remove: boolean; persisted: boolean } {
    const result = releaseAdmissionOwner(entry, ownerId, this.#now(), retryRequired)
    let persisted = result.remove
      ? this.remove(storageKey)
      : this.set(storageKey, result.entry, protectedStorageKeys)
    if (result.remove && !persisted)
      persisted = this.set(storageKey, result.entry, protectedStorageKeys)
    return { ...result, persisted }
  }

  remove(storageKey: string): boolean {
    if (!this.isDurableKey(storageKey)) return false
    try {
      if (!this.#storage) return false
      this.#storage.removeItem(storageKey)
      return true
    } catch {
      return false
    }
  }

  #pruneInvalidEntries(storage: AdmissionStorage): StoredAdmissionEntry[] {
    const now = this.#now()
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
      (key): key is string => key?.startsWith(this.#prefix) === true,
    )
    const entries: StoredAdmissionEntry[] = []
    for (const storageKey of keys) {
      try {
        const value = storage.getItem(storageKey)
        const entry = value ? parseStoredAdmissionEntry(value, now) : undefined
        if (!entry) {
          this.remove(storageKey)
          continue
        }
        entries.push({ storageKey, entry })
      } catch {
        this.remove(storageKey)
      }
    }
    return entries
  }
}

export function getAdmissionStorage(): AdmissionStorage | null {
  try {
    return (globalThis as { localStorage?: AdmissionStorage }).localStorage ?? null
  } catch {
    return null
  }
}
