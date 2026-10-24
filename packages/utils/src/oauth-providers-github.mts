import {
  OAuthProviderError,
  asRecord,
  compact,
  isRecord,
  nowOf,
  parseTokens,
  requestJson,
  str,
  type OAuthProvider,
} from './oauth-providers-core.mts'

export interface GithubProviderConfig {
  clientId: string
  clientSecret: string
}

/** JSON token exchange; the verified email is the primary verified address from `/user/emails`. */
export function githubProvider(config: GithubProviderConfig): OAuthProvider {
  return {
    id: 'github',
    async redeem(input, ctx) {
      const tokenPayload = await requestJson(
        'github',
        'GitHub token exchange',
        ctx,
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code: input.code,
            redirect_uri: input.redirectUri,
            ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
          }),
        },
      )
      const { accessToken } = parseTokens('github', tokenPayload, nowOf(ctx))
      const init = {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
      }
      const [userPayload, emailsPayload] = await Promise.all([
        requestJson('github', 'GitHub /user request', ctx, 'https://api.github.com/user', init),
        requestJson(
          'github',
          'GitHub /user/emails request',
          ctx,
          'https://api.github.com/user/emails',
          init,
        ),
      ])
      const user = asRecord('github', userPayload, 'GitHub /user response')
      if (typeof user.id !== 'number' && !str(user.id)) {
        throw new OAuthProviderError('github', 'malformed', 'GitHub /user response is missing id')
      }
      if (!Array.isArray(emailsPayload)) {
        throw new OAuthProviderError('github', 'malformed', 'GitHub emails response is not a list')
      }
      const primary = emailsPayload.find(
        (entry) => isRecord(entry) && entry.primary === true && entry.verified === true,
      ) as { email?: unknown } | undefined
      const login = str(user.login)
      return {
        tokens: { accessToken },
        profile: {
          providerUserId: String(user.id),
          verifiedEmail: str(primary?.email) ?? null,
          data: compact({ login, name: str(user.name) ?? login, avatar_url: str(user.avatar_url) }),
        },
      }
    },
  }
}
