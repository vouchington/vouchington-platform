import {
  OAuthProviderError,
  asRecord,
  formBody,
  nowOf,
  parseTokens,
  requestJson,
  str,
  type OAuthProvider,
} from './oauth-providers-core.mts'

export interface FacebookProviderConfig {
  appId: string
  appSecret: string
  /** Graph API version path segment, for example `v1.0`. */
  graphVersion: string
}

/** Code exchange, then `fb_exchange_token` for a long-lived token, then `/me`. */
export function facebookProvider(config: FacebookProviderConfig): OAuthProvider {
  const graph = `https://graph.facebook.com/${config.graphVersion}`
  const form = (values: Record<string, string>) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ client_id: config.appId, client_secret: config.appSecret, ...values }),
  })
  return {
    id: 'facebook',
    async redeem(input, ctx) {
      const now = nowOf(ctx)
      const shortLived = parseTokens(
        'facebook',
        await requestJson(
          'facebook',
          'Facebook authorization code exchange',
          ctx,
          `${graph}/oauth/access_token`,
          form({ redirect_uri: input.redirectUri, code: input.code }),
        ),
        now,
      )
      const tokens = parseTokens(
        'facebook',
        await requestJson(
          'facebook',
          'Facebook token exchange',
          ctx,
          `${graph}/oauth/access_token`,
          form({ grant_type: 'fb_exchange_token', fb_exchange_token: shortLived.accessToken }),
        ),
        now,
      )
      const mePayload = await requestJson(
        'facebook',
        'Facebook /me request',
        ctx,
        `${graph}/me?fields=name,email`,
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
      )
      const me = asRecord('facebook', mePayload, 'Facebook /me response')
      const id = str(me.id)
      if (!id) throw new OAuthProviderError('facebook', 'malformed', 'Facebook user is missing id')
      return {
        tokens,
        profile: { providerUserId: id, verifiedEmail: str(me.email) ?? null, data: me },
      }
    },
  }
}
