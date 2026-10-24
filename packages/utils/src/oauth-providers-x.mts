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

export interface XProviderConfig {
  clientId: string
  clientSecret: string
}

/** Basic-auth token exchange; PKCE is required and X exposes no verified email. */
export function xProvider(config: XProviderConfig): OAuthProvider {
  return {
    id: 'x',
    async redeem(input, ctx) {
      const codeVerifier = requireCodeVerifier('x', input)
      const tokenPayload = await requestJson(
        'x',
        'X token exchange',
        ctx,
        'https://api.x.com/2/oauth2/token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
          },
          body: formBody({
            grant_type: 'authorization_code',
            code: input.code,
            redirect_uri: input.redirectUri,
            code_verifier: codeVerifier,
          }),
        },
      )
      const tokens = parseTokens('x', tokenPayload, nowOf(ctx))
      const userPayload = await requestJson(
        'x',
        'X /users/me request',
        ctx,
        'https://api.x.com/2/users/me?user.fields=profile_image_url',
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
      )
      const user = asRecord('x', asRecord('x', userPayload, 'X /users/me response').data, 'X user')
      const id = str(user.id)
      if (!id) throw new OAuthProviderError('x', 'malformed', 'X user is missing id')
      return {
        tokens,
        profile: {
          providerUserId: id,
          verifiedEmail: null,
          data: compact({
            name: user.name,
            username: user.username,
            profile_image_url: str(user.profile_image_url),
          }),
        },
      }
    },
  }
}
