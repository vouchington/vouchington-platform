import { AuthError } from './errors.mts'

export interface OAuthProvider<Input, Account> {
  exchange(input: Input, expectedOrigin?: string): Promise<Account>
}

export interface OAuthOptions<Input, Account, UserId, Context, Continued, Connected = Account> {
  getProvider(provider: string): OAuthProvider<Input, Account> | undefined
  isKnownProvider?(provider: string): boolean
  connect(input: {
    provider: string
    userId: UserId
    account: Account
    context: Context
  }): Promise<Connected>
  continue(input: { provider: string; account: Account; context: Context }): Promise<Continued>
}

export function createOAuth<Input, Account, UserId, Context, Continued, Connected = Account>(
  options: OAuthOptions<Input, Account, UserId, Context, Continued, Connected>,
) {
  async function exchange(providerName: string, input: Input, expectedOrigin?: string) {
    const provider = options.getProvider(providerName)
    if (!provider) {
      if (options.isKnownProvider?.(providerName) === false)
        throw new AuthError('invalid_request', 400, 'Unknown OAuth provider')
      throw new AuthError('provider_disabled', 404, 'OAuth provider is not enabled')
    }
    return provider.exchange(input, expectedOrigin)
  }

  return {
    async connect(input: {
      provider: string
      userId: UserId
      authorization: Input
      expectedOrigin?: string
      context: Context
    }): Promise<Connected> {
      const account = await exchange(input.provider, input.authorization, input.expectedOrigin)
      return options.connect({
        provider: input.provider,
        userId: input.userId,
        account,
        context: input.context,
      })
    },
    async continue(input: {
      provider: string
      authorization: Input
      expectedOrigin?: string
      context: Context
    }): Promise<Continued> {
      const account = await exchange(input.provider, input.authorization, input.expectedOrigin)
      return options.continue({ provider: input.provider, account, context: input.context })
    },
  }
}
