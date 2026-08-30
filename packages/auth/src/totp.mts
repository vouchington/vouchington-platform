import * as OTPAuth from 'otpauth'

export interface TotpOptions {
  issuer: string
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512'
  digits?: 6 | 7 | 8
  period?: number
  window?: number
  secretBytes?: number
}

export function createTotp(options: TotpOptions) {
  if (!options.issuer.trim()) throw new TypeError('issuer must not be empty')
  const period = options.period ?? 30
  const window = options.window ?? 1
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
    verify(accountName: string, secret: string, token: string): boolean {
      const totp = authenticator(accountName, OTPAuth.Secret.fromBase32(secret))
      return totp.validate({ token, window }) !== null
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
