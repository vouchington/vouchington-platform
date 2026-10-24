import {
  OAuthProviderError,
  asRecord,
  compact,
  formBody,
  nowOf,
  parseTokens,
  requestJson,
  requireCodeVerifier,
  str,
  type OAuthProvider,
} from './oauth-providers-core.mts'

export interface GoogleProviderConfig {
  clientId: string
  clientSecret: string
}

/** Confidential code exchange with required PKCE, then OIDC userinfo keyed by `sub`. */
export function googleProvider(config: GoogleProviderConfig): OAuthProvider {
  return {
    id: 'google',
    async redeem(input, ctx) {
      const codeVerifier = requireCodeVerifier('google', input)
      const tokenPayload = await requestJson(
        'google',
        'Google token exchange',
        ctx,
        'https://oauth2.googleapis.com/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formBody({
            grant_type: 'authorization_code',
            code: input.code,
            redirect_uri: input.redirectUri,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code_verifier: codeVerifier,
          }),
        },
      )
      const tokens = parseTokens('google', tokenPayload, nowOf(ctx))
      const infoPayload = await requestJson(
        'google',
        'Google UserInfo request',
        ctx,
        'https://openidconnect.googleapis.com/v1/userinfo',
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
      )
      const info = asRecord('google', infoPayload, 'Google UserInfo response')
      const sub = str(info.sub)
      if (!sub)
        throw new OAuthProviderError('google', 'malformed', 'Google UserInfo is missing sub')
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
