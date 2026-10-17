export type OAuthErrorCode =
  | 'access_denied'
  | 'invalid_client'
  | 'invalid_client_metadata'
  | 'invalid_grant'
  | 'invalid_redirect_uri'
  | 'invalid_request'
  | 'invalid_scope'
  | 'invalid_target'
  | 'server_error'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'

/** Protocol failure carrying the RFC 6749 error code and the HTTP status a token endpoint uses. */
export class OAuthProtocolError extends Error {
  readonly code: OAuthErrorCode
  readonly status: number

  constructor(code: OAuthErrorCode, description: string, status = 400, options?: ErrorOptions) {
    super(description, options)
    this.name = 'OAuthProtocolError'
    this.code = code
    this.status = status
  }
}

export function invalidRequest(description: string): OAuthProtocolError {
  return new OAuthProtocolError('invalid_request', description)
}

export function invalidGrant(description: string): OAuthProtocolError {
  return new OAuthProtocolError('invalid_grant', description)
}

export function invalidTarget(): OAuthProtocolError {
  return new OAuthProtocolError('invalid_target', 'resource is not supported')
}

export function invalidClientMetadata(description: string): OAuthProtocolError {
  return new OAuthProtocolError('invalid_client_metadata', description)
}

export function invalidRedirectUri(description: string): OAuthProtocolError {
  return new OAuthProtocolError('invalid_redirect_uri', description)
}

export function invalidClient(description = 'client authentication failed'): OAuthProtocolError {
  return new OAuthProtocolError('invalid_client', description, 401)
}
