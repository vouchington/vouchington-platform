import * as OTPAuth from 'otpauth'
import { describe, expect, it } from 'vitest'
import { createTotp } from './totp.mts'

describe('TOTP', () => {
  it('creates setup material and verifies current codes with secure defaults', () => {
    const totp = createTotp({ issuer: 'Example' })
    const setup = totp.createSetup('person@example.test')
    expect(setup.secret).toMatch(/^[A-Z2-7]+$/)
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\//)
    const token = new OTPAuth.TOTP({
      issuer: 'Example',
      label: 'person@example.test',
      secret: OTPAuth.Secret.fromBase32(setup.secret),
    }).generate()
    const copiedToken = `${token.slice(0, 3)} ${token.slice(3)}`
    expect(totp.verify('person@example.test', setup.secret, copiedToken)).toBe(true)
    expect(totp.verify('person@example.test', setup.secret, '000000')).toBe(false)
  })

  it('supports configured algorithms and validates inputs', () => {
    const totp = createTotp({
      issuer: 'Example',
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
      window: 0,
      secretBytes: 32,
    })
    expect(totp.createSetup('account').uri).toContain('algorithm=SHA256')
    expect(() => totp.createSetup(' ')).toThrow('accountName')
    expect(() => createTotp({ issuer: ' ' })).toThrow('issuer')
    expect(() => createTotp({ issuer: 'Example', period: 0 })).toThrow('period')
    expect(() => createTotp({ issuer: 'Example', window: -1 })).toThrow('window')
    expect(() => createTotp({ issuer: 'Example', secretBytes: 0 })).toThrow('secretBytes')
  })
})
