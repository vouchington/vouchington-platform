import { AuthError } from './errors.mts'
import type { AuthenticationFlowOptions, AuthenticationResult } from './types.mts'

export function createAuthenticationFlow<Identity, User, Session, Context>(
  options: AuthenticationFlowOptions<Identity, User, Session, Context>,
) {
  return async function authenticate(
    identity: Identity,
    context: Context,
  ): Promise<AuthenticationResult<User, Session>> {
    const user = await options.resolveUser(identity, context)
    if (await options.isSuspended(user, context)) {
      throw new AuthError('invalid_credentials', 403, 'Account unavailable')
    }
    if (await options.hasMfa(user, context)) {
      return {
        status: 'mfa_required',
        attemptId: await options.createMfaAttempt(user, context),
      }
    }
    return { status: 'authenticated', user, session: await options.issueSession(user, context) }
  }
}
