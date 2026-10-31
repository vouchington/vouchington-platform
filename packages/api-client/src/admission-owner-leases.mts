export const ADMISSION_OWNER_LEASE_MS = 5 * 60 * 1000

export type AdmissionOwnerEntry = {
  ownerIds?: string[]
  ownerLeases?: Record<string, number>
  retryRequired?: boolean
  successObserved?: boolean
}

export function claimAdmissionOwner<T extends AdmissionOwnerEntry>(
  entry: T,
  ownerId: string,
  now: number,
): T {
  const ownerLeases = activeOwnerLeases(entry, now)
  const retriesWithoutLiveOwner = entry.retryRequired && Object.keys(ownerLeases).length === 0
  return {
    ...entry,
    ownerLeases: { ...ownerLeases, [ownerId]: now + ADMISSION_OWNER_LEASE_MS },
    retryRequired: Object.keys(ownerLeases).length === 0 ? undefined : entry.retryRequired,
    successObserved: retriesWithoutLiveOwner ? undefined : entry.successObserved,
  }
}

export function renewAdmissionOwner<T extends AdmissionOwnerEntry>(
  entry: T,
  ownerId: string,
  now: number,
): T {
  return {
    ...entry,
    ownerLeases: {
      ...activeOwnerLeases(entry, now),
      [ownerId]: now + ADMISSION_OWNER_LEASE_MS,
    },
  }
}

export function releaseAdmissionOwner<T extends AdmissionOwnerEntry>(
  entry: T,
  ownerId: string,
  now: number,
  retryRequired: boolean,
): { entry: T; remove: boolean } {
  const { [ownerId]: _releasedOwner, ...ownerLeases } = activeOwnerLeases(entry, now)
  const retained = {
    ...entry,
    ownerLeases,
    retryRequired: entry.retryRequired || retryRequired,
    successObserved: entry.successObserved || !retryRequired,
  }
  return {
    entry: retained,
    remove: !retained.retryRequired && Object.keys(ownerLeases).length === 0,
  }
}

export function normalizeAdmissionOwners<T extends AdmissionOwnerEntry>(entry: T, now: number): T {
  const ownerLeases = activeOwnerLeases(entry, now)
  // Every owner's lease expired without observing success: the request outcome is unknown.
  const abandonedOwners =
    !entry.successObserved &&
    Object.keys(entry.ownerLeases ?? {}).length > 0 &&
    Object.keys(ownerLeases).length === 0
  return {
    ...entry,
    ownerIds: undefined,
    ownerLeases: undefined,
    ...(Object.keys(ownerLeases).length > 0 ? { ownerLeases } : {}),
    ...(entry.retryRequired || abandonedOwners ? { retryRequired: true } : {}),
  }
}

function activeOwnerLeases(entry: AdmissionOwnerEntry, now: number): Record<string, number> {
  const legacy = Object.fromEntries(
    (entry.ownerIds ?? []).map((ownerId) => [ownerId, now + ADMISSION_OWNER_LEASE_MS]),
  )
  return Object.fromEntries(
    Object.entries({ ...legacy, ...entry.ownerLeases }).filter(([, expiry]) => expiry > now),
  )
}
