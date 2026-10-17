import { invalidClient } from './errors.mts'
import type { ClientCredentials } from './request.mts'
import { safeEqual } from './secrets.mts'
import type { ClientStore, HashSecret, OAuthClient } from './types.mts'

/** Authenticates a client at the token or revocation endpoint with a timing-safe secret check. */
export async function authenticateClient(
  store: ClientStore,
  credentials: ClientCredentials,
  hashSecret: HashSecret,
): Promise<OAuthClient> {
  const client = await store.findClient(credentials.clientId)
  if (!client) throw invalidClient()
  if (client.tokenEndpointAuthMethod === 'none') {
    if (credentials.clientSecret !== undefined) throw invalidClient('public client sent a secret')
    return client
  }
  if (!credentials.clientSecret || !client.clientSecretHash) throw invalidClient()
  const presented = hashSecret('client-secret', credentials.clientSecret)
  if (!safeEqual(presented, client.clientSecretHash)) throw invalidClient()
  return client
}
