export interface AuthorizationServerMetadataOptions {
  issuer: string
  scopesSupported: readonly string[]
  /** Absolute endpoint URLs; each defaults to the issuer plus its conventional path. */
  endpoints?: {
    authorization?: string
    token?: string
    registration?: string
    revocation?: string
  }
  /** Extra RFC 8414 members, such as application-specific capability flags. */
  extra?: Readonly<Record<string, unknown>>
}

/** RFC 8414 metadata for the supported subset: code + refresh grants, S256 PKCE, RFC 9207 iss. */
export function buildAuthorizationServerMetadata(options: AuthorizationServerMetadataOptions) {
  const { issuer, endpoints = {} } = options
  const base = issuer.replace(/\/+$/u, '')
  const methods = ['client_secret_basic', 'none']
  return {
    issuer,
    authorization_endpoint: endpoints.authorization ?? `${base}/authorize`,
    token_endpoint: endpoints.token ?? `${base}/token`,
    registration_endpoint: endpoints.registration ?? `${base}/register`,
    revocation_endpoint: endpoints.revocation ?? `${base}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: methods,
    revocation_endpoint_auth_methods_supported: methods,
    scopes_supported: options.scopesSupported.toSorted(),
    authorization_response_iss_parameter_supported: true,
    ...options.extra,
  }
}

/** RFC 9728 metadata document for one protected resource. */
export function buildProtectedResourceMetadata(options: {
  resource: string
  issuer: string
  scopesSupported: readonly string[]
}) {
  return {
    resource: options.resource,
    authorization_servers: [options.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: options.scopesSupported.toSorted(),
  }
}

/** RFC 9728 inserts the well-known segment between the origin and the resource path. */
export function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource)
  const path = url.pathname === '/' ? '' : url.pathname
  return `${url.origin}/.well-known/oauth-protected-resource${path}${url.search}`
}
