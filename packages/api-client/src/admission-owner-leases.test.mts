import { describe, expect, it } from 'vitest'
import {
  ADMISSION_OWNER_LEASE_MS,
  claimAdmissionOwner,
  normalizeAdmissionOwners,
  releaseAdmissionOwner,
  renewAdmissionOwner,
  type AdmissionOwnerEntry,
} from './admission-owner-leases.mts'
import { ADMISSION_RETENTION_MS, parseStoredAdmissionEntry } from './admission-storage-entry.mts'

describe('admission idempotency owner leases', () => {
  it('bounds legacy owner IDs with expiring leases', () => {
    expect(normalizeAdmissionOwners({ ownerIds: ['legacy-owner'] }, 1000)).toEqual({
      ownerIds: undefined,
      ownerLeases: { 'legacy-owner': 1000 + ADMISSION_OWNER_LEASE_MS },
    })
  })

  it('preserves an uncertain peer result when a live owner renews late', () => {
    const firstOwner = 'first-owner'
    const secondOwner = 'second-owner'
    const initial = claimAdmissionOwner({} as AdmissionOwnerEntry, firstOwner, 0)
    const shared = claimAdmissionOwner(initial, secondOwner, 0)
    const afterFailure = releaseAdmissionOwner(
      shared,
      firstOwner,
      ADMISSION_OWNER_LEASE_MS + 1,
      true,
    ).entry

    const renewed = renewAdmissionOwner(afterFailure, secondOwner, ADMISSION_OWNER_LEASE_MS + 1)
    expect(renewed.retryRequired).toBe(true)
    const afterSuccess = releaseAdmissionOwner(
      renewed,
      secondOwner,
      ADMISSION_OWNER_LEASE_MS + 1,
      false,
    )
    expect(afterSuccess.remove).toBe(false)
    expect(afterSuccess.entry).toMatchObject({ retryRequired: true, successObserved: true })

    const replay = claimAdmissionOwner(
      afterSuccess.entry,
      'replay-owner',
      ADMISSION_OWNER_LEASE_MS + 1,
    )
    expect(
      releaseAdmissionOwner(replay, 'replay-owner', ADMISSION_OWNER_LEASE_MS + 1, false).remove,
    ).toBe(true)
  })

  it('retains uncertainty when a sole retry owner expires', () => {
    const now = 1000
    const retried = claimAdmissionOwner(
      { retryRequired: true, successObserved: true },
      'retry-owner',
      now,
    )
    const expired = normalizeAdmissionOwners(retried, now + ADMISSION_OWNER_LEASE_MS + 1)

    expect(retried).toMatchObject({ successObserved: undefined, retryRequired: undefined })
    expect(
      parseStoredAdmissionEntry(
        JSON.stringify({
          version: 1,
          intentFingerprint: 'intent',
          key: crypto.randomUUID(),
          expiresAt: now + ADMISSION_RETENTION_MS,
          ...expired,
        }),
        now + ADMISSION_OWNER_LEASE_MS + 1,
      ),
    ).toMatchObject({ intentFingerprint: 'intent' })
  })
})
