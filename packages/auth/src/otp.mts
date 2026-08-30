import { randomBytes } from 'node:crypto'
import { AuthError } from './errors.mts'
import type { AttemptLimiter } from './types.mts'

export type EmailOtpAttempt<Context> = {
  email: string
  context: Context
}

export interface EmailOtpStore {
  put(input: { email: string; digest: string; expiresAt: Date }): Promise<void>
  consume(input: { email: string; digest: string; now: Date }): Promise<boolean>
}

export interface EmailOtpOptions<DeliveryContext = undefined> {
  normalizeEmail(email: string): Promise<string> | string
  digest(token: string): Promise<string> | string
  store: EmailOtpStore
  deliver(input: { email: string; token: string; context: DeliveryContext }): Promise<void>
  ttlSeconds: number
  tokenBytes?: number
  now?: () => Date
  createRandomBytes?: typeof randomBytes
  requestLimiter?: AttemptLimiter<EmailOtpAttempt<DeliveryContext>>
  verificationLimiter?: AttemptLimiter<EmailOtpAttempt<DeliveryContext>>
}

export function createEmailOtp<DeliveryContext = undefined>(
  options: EmailOtpOptions<DeliveryContext>,
) {
  const tokenBytes = options.tokenBytes ?? 4
  assertPositiveInteger(options.ttlSeconds, 'ttlSeconds')
  assertPositiveInteger(tokenBytes, 'tokenBytes')
  const now = options.now ?? (() => new Date())
  const createBytes = options.createRandomBytes ?? randomBytes

  return {
    async request(email: string, context: DeliveryContext): Promise<{ email: string }> {
      const normalized = await options.normalizeEmail(email)
      await recordAttempt(options.requestLimiter, { email: normalized, context })
      const token = createBytes(tokenBytes).toString('hex').toUpperCase()
      const issuedAt = now()
      await options.store.put({
        email: normalized,
        digest: await options.digest(token),
        expiresAt: new Date(issuedAt.getTime() + options.ttlSeconds * 1_000),
      })
      await options.deliver({ email: normalized, token, context })
      return { email: normalized }
    },

    async verify(
      email: string,
      token: string,
      context: DeliveryContext,
    ): Promise<{ email: string }> {
      const normalized = await options.normalizeEmail(email)
      await recordAttempt(options.verificationLimiter, { email: normalized, context })
      const consumed = await options.store.consume({
        email: normalized,
        digest: await options.digest(token.toUpperCase()),
        now: now(),
      })
      if (!consumed)
        throw new AuthError(
          'invalid_credentials',
          401,
          'Invalid email address or one-time password',
        )
      return { email: normalized }
    },
  }
}

async function recordAttempt<Input>(limiter: AttemptLimiter<Input> | undefined, input: Input) {
  if (limiter && ((await limiter.isLimited?.(input)) || (await limiter.record(input))))
    throw new AuthError('rate_limited', 429, 'Too many authentication attempts')
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive safe integer`)
}
