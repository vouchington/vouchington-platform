import { randomUUID } from 'node:crypto'
import { AuthError } from './errors.mts'
import { isWellFormedUnicode } from './state-key.mts'
import type { ExpiringStateStore } from './types.mts'

export interface MfaStateOptions {
  store: ExpiringStateStore
  attemptTtlSeconds: number
  reauthenticationTtlSeconds: number
  namespace?: string
  createId?: () => string
  keys?: {
    attempt(id: string): string
    reauthentication(userId: string, token: string): string
  }
  isValidId?: (id: string) => boolean
}

export function createMfaState<Attempt>(options: MfaStateOptions) {
  assertTtl(options.attemptTtlSeconds, 'attemptTtlSeconds')
  assertTtl(options.reauthenticationTtlSeconds, 'reauthenticationTtlSeconds')
  const namespace = options.namespace ?? 'auth'
  const createId = options.createId ?? randomUUID
  const segment = (value: string) => encodeURIComponent(value)
  const keys = options.keys
  const attemptKey = keys
    ? (id: string) => keys.attempt(id)
    : (id: string) => `${namespace}:mfa-attempt:${segment(id)}`
  const reauthenticationKey =
    keys === undefined
      ? (userId: string, token: string) =>
          `${namespace}:mfa-reauthentication:${segment(userId)}:${segment(token)}`
      : (userId: string, token: string) => keys.reauthentication(userId, token)
  const valid = (id: string) =>
    isWellFormedUnicode(id) && (options.isValidId?.(id) ?? id.length > 0)

  return {
    async createAttempt(attempt: Attempt): Promise<string> {
      const id = createId()
      if (!valid(id)) throw new TypeError('createId returned an invalid identifier')
      await options.store.put(attemptKey(id), attempt, options.attemptTtlSeconds)
      return id
    },
    peekAttempt(id: string): Promise<Attempt | null> {
      if (!valid(id)) return Promise.resolve(null)
      return options.store.get<Attempt>(attemptKey(id))
    },
    consumeAttempt(id: string): Promise<Attempt | null> {
      if (!valid(id)) return Promise.resolve(null)
      return options.store.consume<Attempt>(attemptKey(id))
    },
    async requireAttempt(id: string): Promise<Attempt> {
      if (!valid(id)) throw new AuthError('invalid_credentials', 401, 'Login attempt expired')
      const attempt = await options.store.get<Attempt>(attemptKey(id))
      if (attempt === null) throw new AuthError('invalid_credentials', 401, 'Login attempt expired')
      return attempt
    },
    async createReauthentication(userId: string): Promise<string> {
      if (!isWellFormedUnicode(userId)) throw new TypeError('userId must be well-formed Unicode')
      const token = createId()
      if (!valid(token)) throw new TypeError('createId returned an invalid identifier')
      await options.store.put(
        reauthenticationKey(userId, token),
        true,
        options.reauthenticationTtlSeconds,
      )
      return token
    },
    async consumeReauthentication(userId: string, token: string): Promise<boolean> {
      if (!isWellFormedUnicode(userId) || !valid(token)) return false
      return (await options.store.consume<boolean>(reauthenticationKey(userId, token))) === true
    },
  }
}

function assertTtl(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive safe integer`)
}
