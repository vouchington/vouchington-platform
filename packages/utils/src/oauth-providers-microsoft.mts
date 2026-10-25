import { createOidcIdTokenVerifier } from './oidc-id-token.mts'
import { microsoftProfileFromClaims } from './oidc-id-token-profiles.mts'
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

const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface MicrosoftProviderConfig {
  clientId: string
  clientSecret: string
  /** Defaults to `common`. */
  tenantId?: string
}

/** Request these scopes in the authorization URL for ID-token email and Graph /me. */
export const microsoftAuthorizationScopes = 'openid email User.Read'

/** v2.0 code exchange with PKCE, signed ID-token email proof, and Graph profile data. */
export function microsoftProvider(config: MicrosoftProviderConfig): OAuthProvider {
  return {
    id: 'microsoft',
    async redeem(input, ctx) {
      const codeVerifier = requireCodeVerifier('microsoft', input)
      const tenant = config.tenantId || 'common'
      const login = `https://login.microsoftonline.com/${tenant}`
      const tokenPayload = await requestJson(
        'microsoft',
        'Microsoft token exchange',
        ctx,
        `${login}/oauth2/v2.0/token`,
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
            scope: microsoftAuthorizationScopes,
          }),
        },
      )
      const tokens = parseTokens('microsoft', tokenPayload, nowOf(ctx))
      const body = asRecord('microsoft', tokenPayload, 'Microsoft token response')
      const idToken = str(body.id_token)
      if (!idToken) {
        throw new OAuthProviderError('microsoft', 'malformed', 'Token response is missing id_token')
      }
      const alias = tenant === 'common' || tenant === 'organizations'
      const verifier = createOidcIdTokenVerifier({
        jwksUri: `${login}/discovery/v2.0/keys`,
        issuers: [],
        issuerMatches: (claims, keyIssuer) => {
          const tid = claims.tid
          if (typeof tid !== 'string' || !TENANT_ID.test(tid)) return false
          const issuer = `https://login.microsoftonline.com/${tid}/v2.0`
          return (
            (alias || tid === tenant) &&
            claims.iss === issuer &&
            (keyIssuer === undefined || keyIssuer.replace('{tenantid}', tid) === issuer)
          )
        },
        audiences: () => [config.clientId],
        fetch: ctx.fetch,
        ...(ctx.now ? { now: ctx.now } : {}),
      })
      const claims = await verifier.verify(idToken, ctx.signal ? { signal: ctx.signal } : {})
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
      if (claims.oid !== id) {
        throw new OAuthProviderError(
          'microsoft',
          'malformed',
          'ID token user does not match Graph user',
        )
      }
      const signedProfile = microsoftProfileFromClaims(claims)
      return {
        tokens,
        profile: {
          providerUserId: id,
          verifiedEmail: signedProfile.verifiedEmail,
          data: compact({
            name: str(me.displayName),
            email: str(me.mail),
            given_name: str(me.givenName),
            family_name: str(me.surname),
          }),
        },
      }
    },
  }
}
