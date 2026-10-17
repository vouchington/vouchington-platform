import { canonicalizeAdmissionIntent, fingerprintAdmissionIntent } from './admission-intent.mts'
import { identifyAdmissionIntent, type AdmissionFingerprintState } from './admission-identify.mts'
import {
  admissionStoragePrefix,
  getActiveAdmissionStorageKeys,
  getAdmissionLockManager,
  withAdmissionAllocationLock,
} from './admission-lock.mts'
import { startAdmissionOwnerLeaseRenewal } from './admission-owner-renewal.mts'
import { settleWithin } from './admission-settle.mts'
import { ADMISSION_RETENTION_MS } from './admission-storage-entry.mts'
import { AdmissionEntryStore, getAdmissionStorage } from './admission-storage.mts'
import type {
  AdmissionIdempotencyEntry as Entry,
  AdmissionIdempotencyOptions,
} from './admission-types.mts'

/** Pairs each distinct admission intent with one idempotency key so retries (even after a reload,
 * with durable storage and Web Locks) reuse it. The application owns the request and namespace. */
export class AdmissionIdempotency {
  readonly #entries = new Map<string, Entry>()
  readonly #activeRequests = new Set<Promise<unknown>>()
  readonly #generateKey: () => string
  readonly #lockManager: Exclude<AdmissionIdempotencyOptions['lockManager'], undefined>
  readonly #store: AdmissionEntryStore
  readonly #now: () => number
  readonly #fingerprint: (value: string) => Promise<string>
  readonly #fingerprintState: AdmissionFingerprintState = { available: true }
  readonly #namespace: string
  readonly #transientFields: ReadonlySet<string>
  readonly #onError: (error: unknown) => void
  #actorId: string | null | undefined
  readonly #ownerId = crypto.randomUUID()
  #paused = false
  #retainSuccessfulSettlements = false
  constructor(
    generateKey: () => string = () => crypto.randomUUID(),
    options: AdmissionIdempotencyOptions = {},
  ) {
    this.#generateKey = generateKey
    this.#lockManager =
      options.lockManager === undefined ? getAdmissionLockManager() : options.lockManager
    this.#now = options.now ?? Date.now
    this.#namespace = options.namespace ?? 'vouchington'
    this.#store = new AdmissionEntryStore(
      options.storage === undefined ? getAdmissionStorage() : options.storage,
      this.#now,
      admissionStoragePrefix(this.#namespace),
    )
    this.#fingerprint = options.fingerprint ?? fingerprintAdmissionIntent
    this.#transientFields = new Set(options.transientFields)
    this.#onError = options.onError ?? (() => undefined)
    this.#actorId = options.actorId
  }
  async run<T>(
    intent: Record<string, unknown>,
    request: (idempotencyKey: string) => Promise<T>,
  ): Promise<T> {
    if (this.#paused) throw new Error('Admission submissions are paused')
    const activeRequest = this.#execute(intent, request)
    this.#activeRequests.add(activeRequest)
    try {
      return await activeRequest
    } finally {
      this.#activeRequests.delete(activeRequest)
    }
  }
  #lock<T>(storageKey: string, callback: () => Promise<T> | T): Promise<T> {
    return withAdmissionAllocationLock(this.#namespace, storageKey, this.#lockManager, callback)
  }
  async #execute<T>(
    intent: Record<string, unknown>,
    request: (idempotencyKey: string) => Promise<T>,
  ): Promise<T> {
    const canonicalIntent = canonicalizeAdmissionIntent(intent, this.#transientFields)
    const { storageKey, intentFingerprint } = await identifyAdmissionIntent(
      this.#namespace,
      canonicalIntent,
      this.#actorId,
      this.#fingerprint,
      this.#fingerprintState,
    )
    const durable = this.#store.isDurableKey(storageKey)
    const entry = await this.#lock(storageKey, () => {
      const entry = this.#getOrCreateEntry(storageKey, intentFingerprint)
      if (!entry.inFlight && durable) {
        entry.expiresAt = this.#now() + ADMISSION_RETENTION_MS
        if (!this.#store.claim(storageKey, entry, this.#ownerId)) {
          this.#entries.delete(storageKey)
          throw new Error('Durable admission requires writable browser storage')
        }
      }
      return entry
    })
    if (entry.inFlight) return entry.inFlight as Promise<T>
    const requestPromise = Promise.resolve().then(() => request(entry.key))
    entry.inFlight = requestPromise
    const stopOwnerRenewal = startAdmissionOwnerLeaseRenewal({
      entry,
      lockManager: this.#lockManager,
      namespace: this.#namespace,
      onError: this.#onError,
      ownerId: this.#ownerId,
      storageKey,
      store: this.#store,
    })
    const inFlight = requestPromise.finally(stopOwnerRenewal)
    entry.inFlight = inFlight
    try {
      const response = await inFlight
      if (this.#entries.get(storageKey) === entry && entry.inFlight === inFlight) {
        const retryRequired = this.#retainSuccessfulSettlements
        if (durable) {
          await this.#lock(storageKey, () => {
            const persisted = this.#store.get(storageKey, intentFingerprint)
            if (persisted?.key === entry.key)
              this.#store.release(storageKey, persisted, this.#ownerId, retryRequired)
          })
          this.#entries.delete(storageKey)
        } else if (retryRequired) entry.inFlight = undefined
        else {
          this.#entries.delete(storageKey)
          this.#store.remove(storageKey)
        }
      }
      return response
    } catch (err) {
      if (this.#entries.get(storageKey) === entry && entry.inFlight === inFlight) {
        if (durable) {
          let persistenceConfirmed = false,
            superseded = false
          await this.#lock(storageKey, () => {
            const persisted = this.#store.get(storageKey, intentFingerprint)
            if (persisted && persisted.key !== entry.key) superseded = true
            if (persisted?.key === entry.key) {
              const result = this.#store.release(storageKey, persisted, this.#ownerId, true)
              persistenceConfirmed = result.persisted
              if (!result.persisted)
                this.#entries.set(storageKey, { ...entry, ...result.entry, inFlight: undefined })
            }
          })
          if (persistenceConfirmed || superseded) this.#entries.delete(storageKey)
          else if (this.#entries.get(storageKey) === entry) entry.inFlight = undefined
        } else entry.inFlight = undefined
      }
      throw err
    }
  }

  setActor(actorId: string | null): void {
    if (this.#actorId === actorId) return
    this.#entries.clear()
    this.#actorId = actorId
  }

  pause(): void {
    this.#paused = true
  }
  resume(): void {
    this.#paused = false
    this.#retainSuccessfulSettlements = false
  }
  drain(timeoutMs = 5000): Promise<boolean> {
    return settleWithin(this.#activeRequests, timeoutMs, () => {
      this.#retainSuccessfulSettlements = true
    })
  }
  #getOrCreateEntry(storageKey: string, intentFingerprint: string): Entry {
    const existing = this.#getEntry(storageKey, intentFingerprint)
    if (existing?.intentFingerprint === intentFingerprint) return existing
    const entry = {
      intentFingerprint,
      key: this.#generateKey(),
      expiresAt: this.#now() + ADMISSION_RETENTION_MS,
      ownerIds: [],
    }
    this.#entries.set(storageKey, entry)
    if (
      this.#store.isDurableKey(storageKey) &&
      !this.#store.set(storageKey, entry, getActiveAdmissionStorageKeys(this.#entries))
    ) {
      this.#entries.delete(storageKey)
      throw new Error('Durable admission requires writable browser storage')
    }
    return entry
  }

  #getEntry(storageKey: string, intentFingerprint: string): Entry | undefined {
    const memoryEntry = this.#entries.get(storageKey)
    if (memoryEntry?.inFlight || (memoryEntry && memoryEntry.expiresAt > this.#now()))
      return memoryEntry
    this.#entries.delete(storageKey)
    const persisted = this.#store.get(storageKey, intentFingerprint)
    if (!persisted) return undefined
    this.#entries.set(storageKey, persisted)
    return persisted
  }
}
