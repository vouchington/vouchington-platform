import * as OTPAuth from 'otpauth'
import { describe, expect, it, vi } from 'vitest'
import { createTotp } from './totp.mts'

describe('TOTP', () => {
  it('creates setup material and verifies current codes with secure defaults', async () => {
    const replay = { advance: vi.fn(async () => true) }
    const totp = createTotp({ issuer: 'Example', replay, window: 1 })
    const setup = totp.createSetup('person@example.test')
    expect(setup.secret).toMatch(/^[A-Z2-7]+$/)
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\//)
    const token = new OTPAuth.TOTP({
      issuer: 'Example',
      label: 'person@example.test',
      secret: OTPAuth.Secret.fromBase32(setup.secret),
    }).generate()
    const copiedToken = `${token.slice(0, 3)} ${token.slice(3)}`
    const verification = {
      key: 'factor-1',
      accountName: 'person@example.test',
      secret: setup.secret,
    }
    await expect(totp.verify({ ...verification, token: copiedToken })).resolves.toBe(true)
    await expect(totp.verify({ ...verification, token: '000000' })).resolves.toBe(false)
    expect(replay.advance).toHaveBeenCalledWith('factor-1', expect.any(Number))
  })

  it('rejects a valid code when its time step was already consumed', async () => {
    const timestamp = 1_800_000_000_000
    const replay = { advance: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) }
    const totp = createTotp({ issuer: 'Example', replay, window: 0, now: () => timestamp })
    const setup = totp.createSetup('person@example.test')
    const token = new OTPAuth.TOTP({
      issuer: 'Example',
      label: 'person@example.test',
      secret: OTPAuth.Secret.fromBase32(setup.secret),
    }).generate({ timestamp })
    const verification = {
      key: 'factor-1',
      accountName: 'person@example.test',
      secret: setup.secret,
      token,
    }
    await expect(totp.verify(verification)).resolves.toBe(true)
    await expect(totp.verify(verification)).resolves.toBe(false)
    expect(replay.advance).toHaveBeenNthCalledWith(1, 'factor-1', 60_000_000)
    expect(replay.advance).toHaveBeenNthCalledWith(2, 'factor-1', 60_000_000)
  })

  it('supports configured algorithms and validates inputs', () => {
    const replay = { advance: async () => true }
    const totp = createTotp({
      issuer: 'Example',
      replay,
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
      window: 0,
      secretBytes: 32,
    })
    expect(totp.createSetup('account').uri).toContain('algorithm=SHA256')
    expect(() => totp.createSetup(' ')).toThrow('accountName')
    expect(() => createTotp({ issuer: ' ', replay, window: 0 })).toThrow('issuer')
    expect(() => createTotp({ issuer: 'Example', replay } as never)).toThrow('window')
    expect(() => createTotp({ issuer: 'Example', replay, period: 0, window: 0 })).toThrow('period')
    expect(() => createTotp({ issuer: 'Example', replay, window: -1 })).toThrow('window')
    expect(() => createTotp({ issuer: 'Example', replay, window: 0, secretBytes: 0 })).toThrow(
      'secretBytes',
    )
  })
})
