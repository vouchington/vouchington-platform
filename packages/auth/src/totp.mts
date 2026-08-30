import * as OTPAuth from 'otpauth'

export interface TotpReplayStore<Key> {
  /** Atomically advance the key's last-used counter; return false when it was already used. */
  advance(key: Key, counter: number): Promise<boolean>
}

export interface TotpOptions<Key> {
  issuer: string
  replay: TotpReplayStore<Key>
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512'
  digits?: 6 | 7 | 8
  period?: number
  window: number
  secretBytes?: number
  now?: () => number
}

export function createTotp<Key>(options: TotpOptions<Key>) {
  if (!options.issuer.trim()) throw new TypeError('issuer must not be empty')
  const period = options.period ?? 30
  const window = options.window
  const secretBytes = options.secretBytes ?? 20
  assertNonNegativeInteger(window, 'window')
  assertPositiveInteger(period, 'period')
  assertPositiveInteger(secretBytes, 'secretBytes')

  function authenticator(accountName: string, secret: OTPAuth.Secret): OTPAuth.TOTP {
    if (!accountName.trim()) throw new TypeError('accountName must not be empty')
    return new OTPAuth.TOTP({
      issuer: options.issuer,
      label: accountName,
      algorithm: options.algorithm ?? 'SHA1',
      digits: options.digits ?? 6,
      period,
      secret,
    })
  }

  return {
    createSetup(accountName: string): { secret: string; uri: string } {
      const secret = new OTPAuth.Secret({ size: secretBytes })
      return { secret: secret.base32, uri: authenticator(accountName, secret).toString() }
    },
    async verify(input: {
      key: Key
      accountName: string
      secret: string
      token: string
    }): Promise<boolean> {
      const totp = authenticator(input.accountName, OTPAuth.Secret.fromBase32(input.secret))
      const timestamp = options.now?.() ?? Date.now()
      const delta = totp.validate({
        token: input.token.replace(/\s+/g, ''),
        timestamp,
        window,
      })
      if (delta === null) return false
      return options.replay.advance(input.key, totp.counter({ timestamp }) + delta)
    },
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive safe integer`)
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${name} must be a non-negative safe integer`)
}
