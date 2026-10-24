import {
  OAuthProviderError,
  asRecord,
  compact,
  formBody,
  nowOf,
  parseTokens,
  requestJson,
  str,
  type OAuthProvider,
} from './oauth-providers-core.mts'

export interface LinkedinProviderConfig {
  clientId: string
  clientSecret: string
}

/** Form token exchange (optional PKCE) and OIDC userinfo gated on `email_verified`. */
export function linkedinProvider(config: LinkedinProviderConfig): OAuthProvider {
  return {
    id: 'linkedin',
    async redeem(input, ctx) {
      const tokenPayload = await requestJson(
        'linkedin',
        'LinkedIn token exchange',
        ctx,
        'https://www.linkedin.com/oauth/v2/accessToken',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formBody({
            grant_type: 'authorization_code',
            code: input.code,
            redirect_uri: input.redirectUri,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code_verifier: input.codeVerifier,
          }),
        },
      )
      const tokens = parseTokens('linkedin', tokenPayload, nowOf(ctx))
      const infoPayload = await requestJson(
        'linkedin',
        'LinkedIn userinfo request',
        ctx,
        'https://api.linkedin.com/v2/userinfo',
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
      )
      const info = asRecord('linkedin', infoPayload, 'LinkedIn userinfo response')
      const sub = str(info.sub)
      if (!sub)
        throw new OAuthProviderError('linkedin', 'malformed', 'LinkedIn userinfo is missing sub')
      const email = str(info.email)
      return {
        tokens,
        profile: {
          providerUserId: sub,
          verifiedEmail: info.email_verified === true ? (email ?? null) : null,
          data: compact({
            name: str(info.name),
            email,
            picture: str(info.picture),
            given_name: str(info.given_name),
            family_name: str(info.family_name),
          }),
        },
      }
    },
  }
}
