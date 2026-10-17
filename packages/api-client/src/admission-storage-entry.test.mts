import { describe, expect, it } from 'vitest'
import {
  ADMISSION_MAX_CLOCK_SKEW_MS,
  ADMISSION_RETENTION_MS,
  parseStoredAdmissionEntry,
} from './admission-storage-entry.mts'

const NOW = 1_000_000

describe('parseStoredAdmissionEntry', () => {
  it('retains a key after a bounded backward wall-clock correction', () => {
    const entry = parseStoredAdmissionEntry(
      JSON.stringify({
        version: 1,
        intentFingerprint: 'intent',
        key: crypto.randomUUID(),
        expiresAt: NOW + ADMISSION_RETENTION_MS + ADMISSION_MAX_CLOCK_SKEW_MS,
        retryRequired: true,
      }),
      NOW,
    )

    expect(entry).toMatchObject({ intentFingerprint: 'intent', retryRequired: true })
  })

  it('rejects expired and excessive-retention entries', () => {
    const baseEntry = {
      version: 1,
      intentFingerprint: 'intent',
      key: crypto.randomUUID(),
      retryRequired: true,
    }

    expect(
      parseStoredAdmissionEntry(JSON.stringify({ ...baseEntry, expiresAt: NOW }), NOW),
    ).toBeUndefined()
    expect(
      parseStoredAdmissionEntry(
        JSON.stringify({
          ...baseEntry,
          expiresAt: NOW + ADMISSION_RETENTION_MS + ADMISSION_MAX_CLOCK_SKEW_MS + 1,
        }),
        NOW,
      ),
    ).toBeUndefined()
  })

  it('rejects corrupted expiry values', () => {
    const baseEntry = {
      version: 1,
      intentFingerprint: 'intent',
      key: crypto.randomUUID(),
      retryRequired: true,
    }

    expect(
      parseStoredAdmissionEntry(JSON.stringify({ ...baseEntry, expiresAt: 'not-a-time' }), NOW),
    ).toBeUndefined()
    expect(
      parseStoredAdmissionEntry(JSON.stringify({ ...baseEntry, expiresAt: null }), NOW),
    ).toBeUndefined()
  })
})
