import type { AdmissionLockManager } from './admission-lock.mts'
import type { AdmissionStorage } from './admission-storage.mts'
import type { AdmissionStoredEntry } from './admission-storage-entry.mts'

export type AdmissionIdempotencyEntry = AdmissionStoredEntry & {
  inFlight?: Promise<unknown> | undefined
}

export type AdmissionIdempotencyOptions = {
  /** Signed-in actor. Durable cross-reload persistence requires one; anonymous intents stay in memory. */
  actorId?: string | null
  /** Web Locks implementation, or null to disable. Defaults to `navigator.locks`. */
  lockManager?: AdmissionLockManager | null
  /** Durable storage, or null to disable. Defaults to `localStorage`. */
  storage?: AdmissionStorage | null
  now?: () => number
  fingerprint?: (value: string) => Promise<string>
  /** Prefix for storage keys and lock names, so applications own their identifiers. Defaults to 'vouchington'. */
  namespace?: string
  /** Intent fields excluded from the intent identity (captcha tokens, honeypots). */
  transientFields?: Iterable<string>
  /** Receives non-fatal background failures (lease renewal) for reporting. */
  onError?: (error: unknown) => void
}
