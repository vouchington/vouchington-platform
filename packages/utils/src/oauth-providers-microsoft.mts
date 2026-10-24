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

export interface MicrosoftProviderConfig {
  clientId: string
  clientSecret: string
  /** Defaults to `common`. */
  tenantId?: string
}

/** v2.0 token exchange with required PKCE; Graph `mail` is the verified email. */
export function microsoftProvider(config: MicrosoftProviderConfig): OAuthProvider {
  return {
    id: 'microsoft',
    async redeem(input, ctx) {
      const codeVerifier = requireCodeVerifier('microsoft', input)
      const tenant = config.tenantId || 'common'
      const tokenPayload = await requestJson(
        'microsoft',
        'Microsoft token exchange',
        ctx,
        `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
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
      const tokens = parseTokens('microsoft', tokenPayload, nowOf(ctx))
      const mePayload = await requestJson(
        'microsoft',
        'Microsoft Graph /me request',
        ctx,
        'https://graph.microsoft.com/v1.0/me',
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
      )
      const me = asRecord('microsoft', mePayload, 'Microsoft Graph /me response')
      const id = str(me.id)
      if (!id)
        throw new OAuthProviderError('microsoft', 'malformed', 'Microsoft user is missing id')
      const email = str(me.mail)
      return {
        tokens,
        profile: {
          providerUserId: id,
          verifiedEmail: email ?? null,
          data: compact({
            name: str(me.displayName),
            email,
            given_name: str(me.givenName),
            family_name: str(me.surname),
          }),
        },
      }
    },
  }
}
