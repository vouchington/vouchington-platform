import {
  validateAuthMethod,
  validateClientName,
  validateGrantTypes,
  validateRegistrationObject,
  validateResponseTypes,
} from './client-metadata.mts'
import { OAuthProtocolError, invalidClientMetadata } from './errors.mts'
import { validateRedirectUris } from './redirect-uri.mts'
import { parseScopeParameter } from './scopes.mts'
import { generateOpaqueToken } from './secrets.mts'
import type { ClientAuthMethod, ClientRegistry, HashSecret, ScopePolicy } from './types.mts'

export interface RegistrationDependencies {
  registry: ClientRegistry
  scopes: ScopePolicy
  hashSecret: HashSecret
  /** Prefix for generated client ids. Defaults to "client_". */
  clientIdPrefix?: string
  /** Prefix for generated client secrets. Defaults to "secret_". */
  clientSecretPrefix?: string
  /** Used when the request omits token_endpoint_auth_method. Defaults to client_secret_basic. */
  defaultAuthMethod?: ClientAuthMethod
  now?: () => Date
}

/** RFC 7591 section 3.2.1 client information response. */
export interface RegisteredClient {
  client_id: string
  client_id_issued_at: number
  client_name: string
  client_secret?: string
  client_secret_expires_at?: 0
  grant_types: string[]
  redirect_uris: string[]
  response_types: string[]
  scope: string
  token_endpoint_auth_method: ClientAuthMethod
}

/**
 * Validates RFC 7591 metadata and persists the client through the injected registry. The secret is
 * returned once and only its hash is stored. `context` is passed through to `createClient` so the
 * application can attach ownership or other policy.
 */
export async function registerClient(
  input: unknown,
  deps: RegistrationDependencies,
  context?: unknown,
): Promise<RegisteredClient> {
  const metadata = validateRegistrationObject(input)
  const clientName = validateClientName(metadata.client_name)
  const redirectUris = validateRedirectUris(metadata.redirect_uris)
  const method = validateAuthMethod(metadata.token_endpoint_auth_method, deps.defaultAuthMethod)
  const grantTypes = validateGrantTypes(metadata.grant_types)
  const responseTypes = validateResponseTypes(metadata.response_types)
  const scopes = parseRegistrationScopes(metadata.scope, deps.scopes)
  const clientId = generateOpaqueToken(deps.clientIdPrefix ?? 'client_', 24)
  const clientSecret =
    method === 'client_secret_basic'
      ? generateOpaqueToken(deps.clientSecretPrefix ?? 'secret_')
      : undefined
  const issuedAt = deps.now?.() ?? new Date()
  await deps.registry.createClient(
    {
      clientId,
      clientName,
      redirectUris,
      scopes,
      tokenEndpointAuthMethod: method,
      clientSecretHash: clientSecret ? deps.hashSecret('client-secret', clientSecret) : null,
      grantTypes,
      responseTypes,
      issuedAt,
    },
    context,
  )
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(issuedAt.getTime() / 1000),
    client_name: clientName,
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 as const } : {}),
    grant_types: grantTypes,
    redirect_uris: redirectUris,
    response_types: responseTypes,
    scope: scopes.join(' '),
    token_endpoint_auth_method: method,
  }
}

function parseRegistrationScopes(value: unknown, policy: ScopePolicy): string[] {
  try {
    return parseScopeParameter(value, policy).scopes
  } catch (err) {
    if (err instanceof OAuthProtocolError) throw invalidClientMetadata(err.message)
    throw err
  }
}
