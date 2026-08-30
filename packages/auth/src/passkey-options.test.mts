import { describe, expect, it } from 'vitest'
import { createPasskeys } from './passkeys.mts'
import type { PasskeyOptions } from './passkey-types.mts'

describe('passkey options', () => {
  it('requires explicit relying-party and security policy', () => {
    expect(() => createPasskeys({ ...baseOptions(), rpId: ' ' })).toThrow('rpId')
    expect(() => createPasskeys({ ...baseOptions(), rpName: ' ' })).toThrow('rpName')
    expect(() => createPasskeys({ ...baseOptions(), challengeTtlSeconds: 0 })).toThrow(
      'challengeTtlSeconds',
    )
    expect(() => createPasskeys({ ...baseOptions(), timeoutMs: 0 })).toThrow('timeoutMs')
    const { residentKey: _residentKey, ...withoutResidentKey } = baseOptions()
    expect(() => createPasskeys(withoutResidentKey as never)).toThrow('residentKey')
    expect(() => createPasskeys({ ...baseOptions(), residentKey: 'invalid' as never })).toThrow(
      'residentKey',
    )
    const { attestationType: _attestationType, ...withoutAttestation } = baseOptions()
    expect(() => createPasskeys(withoutAttestation as never)).toThrow('attestationType')
    expect(() => createPasskeys({ ...baseOptions(), attestationType: 'invalid' as never })).toThrow(
      'attestationType',
    )
    expect(() => createPasskeys({ ...baseOptions(), authenticatorAttachment: null })).not.toThrow()
    expect(() =>
      createPasskeys({ ...baseOptions(), authenticatorAttachment: 'cross-platform' }),
    ).not.toThrow()
    expect(() =>
      createPasskeys({ ...baseOptions(), authenticatorAttachment: 'invalid' as never }),
    ).toThrow('authenticatorAttachment')
    expect(() => createPasskeys({ ...baseOptions(), supportedAlgorithmIDs: [] })).toThrow(
      'supportedAlgorithmIDs',
    )
    expect(() => createPasskeys({ ...baseOptions(), supportedAlgorithmIDs: [1.5] })).toThrow(
      'supportedAlgorithmIDs',
    )
    expect(() =>
      createPasskeys({ ...baseOptions(), supportedAlgorithmIDs: undefined } as never),
    ).toThrow('supportedAlgorithmIDs')
    const { userIdsEqual: _userIdsEqual, ...withoutEquality } = baseOptions()
    expect(() => createPasskeys(withoutEquality as never)).toThrow('userIdsEqual')
    const { failureLimiter: _failureLimiter, ...withoutLimiter } = baseOptions()
    expect(() => createPasskeys(withoutLimiter as never)).toThrow('failureLimiter')
    expect(() => createPasskeys({ ...baseOptions(), serializeUserId: undefined } as never)).toThrow(
      'serializeUserId',
    )
    const { userVerification: _userVerification, ...withoutPolicy } = baseOptions()
    expect(() => createPasskeys(withoutPolicy as never)).toThrow('userVerification')
    expect(() =>
      createPasskeys({
        ...baseOptions(),
        userVerification: { ...baseOptions().userVerification, authentication: 'invalid' as never },
      }),
    ).toThrow('userVerification')
  })
})

function baseOptions(): PasskeyOptions<string, string, undefined> {
  return {
    rpId: 'example.test',
    rpName: 'Example',
    challengeTtlSeconds: 300,
    timeoutMs: 60_000,
    state: { put: async () => undefined, get: async () => null, consume: async () => null },
    repository: {
      listCredentialIds: async () => [],
      findByCredentialId: async () => null,
      create: async () => undefined,
      updateCounter: async () => true,
    },
    attestationType: 'none',
    authenticatorAttachment: 'platform',
    supportedAlgorithmIDs: [-8, -7, -257],
    residentKey: 'discouraged',
    failureLimiter: { reserve: async () => true },
    userIdsEqual: (left, right) => left === right,
    serializeUserId: String,
    userVerification: {
      registration: 'preferred',
      authentication: 'preferred',
      discoverableAuthentication: 'required',
    },
  }
}
