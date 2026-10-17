import { authenticateClient } from './client-auth.mts'
import { requiredFormValue, type ClientCredentials } from './request.mts'
import type { ClientStore, GrantStore, HashSecret } from './types.mts'

/**
 * RFC 7009 revocation. Authenticates the client, then asks the store to revoke the token under
 * both secret purposes because the token type is not known from the hash. Unknown tokens are not an
 * error, so callers answer 200 on success.
 */
export async function revokeToken(
  form: URLSearchParams,
  credentials: ClientCredentials,
  deps: { clients: ClientStore; grants: Pick<GrantStore, 'revokeToken'>; hashSecret: HashSecret },
): Promise<void> {
  const client = await authenticateClient(deps.clients, credentials, deps.hashSecret)
  const token = requiredFormValue(form, 'token')
  await deps.grants.revokeToken(deps.hashSecret('refresh-token', token), client.clientId)
  await deps.grants.revokeToken(deps.hashSecret('access-token', token), client.clientId)
}
