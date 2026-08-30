import { AuthError } from './errors.mts'
import type { AttemptLimiter } from './types.mts'

export interface MfaAttemptState<Attempt> {
  peekAttempt(id: string): Promise<Attempt | null>
  consumeAttempt(id: string): Promise<Attempt | null>
}

export type MfaVerification<Attempt, Factor, Context> = {
  attemptId: string
  attempt: Attempt
  factor: Factor
  context: Context
}

export interface MfaFlowOptions<Attempt, Factor, Result, Context> {
  state: MfaAttemptState<Attempt>
  limiter: AttemptLimiter<MfaVerification<Attempt, Factor, Context>>
  verify(input: MfaVerification<Attempt, Factor, Context>): Promise<boolean>
  complete(input: { attempt: Attempt; context: Context }): Promise<Result>
}

export function createMfaFlow<Attempt, Factor, Result, Context>(
  options: MfaFlowOptions<Attempt, Factor, Result, Context>,
) {
  return async function verifyAndComplete(input: {
    attemptId: string
    factor: Factor
    context: Context
  }): Promise<Result> {
    const attempt = await options.state.peekAttempt(input.attemptId)
    if (attempt === null) throw new AuthError('invalid_credentials', 401, 'Login attempt expired')
    const verification = { ...input, attempt }
    if (!(await options.limiter.reserve(verification))) return rateLimited()
    if (!(await options.verify(verification))) {
      throw new AuthError('invalid_credentials', 401, 'MFA verification failed')
    }
    const consumed = await options.state.consumeAttempt(input.attemptId)
    if (consumed === null) throw new AuthError('invalid_credentials', 401, 'Login attempt expired')
    return options.complete({ attempt: consumed, context: input.context })
  }
}

function rateLimited(): never {
  throw new AuthError('rate_limited', 429, 'Too many invalid MFA attempts')
}
