import { describe, expect, it } from 'vitest'
import {
  appleProfileFromClaims,
  googleProfileFromClaims,
  microsoftProfileFromClaims,
} from './oidc-id-token.mts'

const base = { iss: 'i', aud: 'a', sub: 'user-1', iat: 1, exp: 2 }

describe('googleProfileFromClaims', () => {
  it('keeps present profile claims and a verified email', () => {
    expect(
      googleProfileFromClaims({
        ...base,
        email: 'a@example.com',
        email_verified: true,
        name: 'Ada',
        picture: 'https://example.com/a.png',
        given_name: 'Ada',
        family_name: 'L',
      }),
    ).toEqual({
      providerUserId: 'user-1',
      verifiedEmail: 'a@example.com',
      data: {
        name: 'Ada',
        email: 'a@example.com',
        picture: 'https://example.com/a.png',
        given_name: 'Ada',
        family_name: 'L',
      },
    })
  })

  it('drops the email when unverified or absent', () => {
    expect(googleProfileFromClaims({ ...base, email: 'a@example.com' }).verifiedEmail).toBeNull()
    expect(googleProfileFromClaims({ ...base, email_verified: true }).verifiedEmail).toBeNull()
    expect(
      googleProfileFromClaims({ ...base, email_verified: 'true', email: 'a@example.com' })
        .verifiedEmail,
    ).toBeNull()
    expect(googleProfileFromClaims(base).data).toEqual({})
  })
})

describe('appleProfileFromClaims', () => {
  it('accepts boolean and string email_verified', () => {
    for (const email_verified of [true, 'true']) {
      expect(
        appleProfileFromClaims(
          { ...base, email: 'a@example.com', email_verified },
          { name: 'Ada' },
        ),
      ).toEqual({
        providerUserId: 'user-1',
        verifiedEmail: 'a@example.com',
        data: { name: 'Ada', email: 'a@example.com' },
      })
    }
  })

  it('returns a null verified email when unverified or missing', () => {
    expect(
      appleProfileFromClaims({ ...base, email: 'a@example.com', email_verified: 'false' })
        .verifiedEmail,
    ).toBeNull()
    expect(appleProfileFromClaims({ ...base, email_verified: true })).toEqual({
      providerUserId: 'user-1',
      verifiedEmail: null,
      data: {},
    })
  })
})

describe('microsoftProfileFromClaims', () => {
  it('uses oid and only trusts a boolean xms_edov claim', () => {
    const claims = { ...base, oid: 'object-1', email: 'a@example.com', name: 'Ada' }
    expect(microsoftProfileFromClaims({ ...claims, xms_edov: true })).toEqual({
      providerUserId: 'object-1',
      verifiedEmail: 'a@example.com',
      data: { name: 'Ada', email: 'a@example.com' },
    })
    for (const xms_edov of [false, undefined, 'true']) {
      expect(microsoftProfileFromClaims({ ...claims, xms_edov }).verifiedEmail).toBeNull()
    }
    expect(microsoftProfileFromClaims({ ...base, xms_edov: true })).toEqual({
      providerUserId: 'user-1',
      verifiedEmail: null,
      data: {},
    })
  })
})
