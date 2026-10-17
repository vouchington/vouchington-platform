import { normalizeAdmissionOwners, type AdmissionOwnerEntry } from './admission-owner-leases.mts'

export const ADMISSION_RETENTION_MS = 48 * 60 * 60 * 1000
export const ADMISSION_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

export type AdmissionStoredEntry = AdmissionOwnerEntry & {
  intentFingerprint: string
  key: string
  expiresAt: number
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseStoredAdmissionEntry(
  value: string,
  now: number,
  intentFingerprint?: string,
): AdmissionStoredEntry | undefined {
  const persisted = JSON.parse(value) as Partial<AdmissionStoredEntry> & { version?: unknown }
  if (
    persisted.version !== 1 ||
    (intentFingerprint !== undefined && persisted.intentFingerprint !== intentFingerprint) ||
    typeof persisted.intentFingerprint !== 'string' ||
    typeof persisted.key !== 'string' ||
    !UUID_PATTERN.test(persisted.key) ||
    typeof persisted.expiresAt !== 'number' ||
    !Number.isFinite(persisted.expiresAt) ||
    persisted.expiresAt <= now ||
    persisted.expiresAt > now + ADMISSION_RETENTION_MS + ADMISSION_MAX_CLOCK_SKEW_MS ||
    !hasValidOwners(persisted)
  )
    return undefined
  const entry = normalizeAdmissionOwners(
    {
      intentFingerprint: persisted.intentFingerprint,
      key: persisted.key,
      expiresAt: persisted.expiresAt,
      ...(persisted.ownerIds ? { ownerIds: persisted.ownerIds } : {}),
      ...(persisted.ownerLeases ? { ownerLeases: persisted.ownerLeases } : {}),
      ...(persisted.retryRequired ? { retryRequired: true } : {}),
      ...(persisted.successObserved ? { successObserved: true } : {}),
    },
    now,
  )
  return entry.successObserved && !entry.retryRequired && !entry.ownerLeases ? undefined : entry
}

function hasValidOwners(entry: Partial<AdmissionStoredEntry>): boolean {
  return (
    (entry.ownerIds === undefined ||
      (Array.isArray(entry.ownerIds) &&
        entry.ownerIds.every((ownerId) => typeof ownerId === 'string'))) &&
    (entry.ownerLeases === undefined ||
      (typeof entry.ownerLeases === 'object' &&
        entry.ownerLeases !== null &&
        !Array.isArray(entry.ownerLeases) &&
        Object.entries(entry.ownerLeases).every(
          ([ownerId, expiresAt]) =>
            typeof ownerId === 'string' &&
            typeof expiresAt === 'number' &&
            Number.isFinite(expiresAt),
        ))) &&
    (entry.retryRequired === undefined || typeof entry.retryRequired === 'boolean') &&
    (entry.successObserved === undefined || typeof entry.successObserved === 'boolean')
  )
}
