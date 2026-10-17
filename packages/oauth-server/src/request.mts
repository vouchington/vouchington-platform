import { invalidClient, invalidClientMetadata, invalidRequest } from './errors.mts'

export interface ClientCredentials {
  clientId: string
  clientSecret?: string
}

function mediaType(contentType: string | undefined): string | undefined {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase()
}

/** Parses an RFC 6749 form body, rejecting other media types and repeated parameters. */
export function parseFormBody(
  contentType: string | undefined,
  body: Buffer | string,
): URLSearchParams {
  if (mediaType(contentType) !== 'application/x-www-form-urlencoded') {
    throw invalidRequest('content type must be form encoded')
  }
  const form = new URLSearchParams(typeof body === 'string' ? body : body.toString('utf8'))
  for (const name of new Set(form.keys())) {
    if (form.getAll(name).length !== 1) throw invalidRequest(`${name} must not be repeated`)
  }
  return form
}

/** Parses an RFC 7591 registration body, which must be a JSON object. */
export function parseRegistrationBody(
  contentType: string | undefined,
  body: Buffer | string,
): unknown {
  if (mediaType(contentType) !== 'application/json') {
    throw invalidClientMetadata('registration metadata must use application/json')
  }
  try {
    return JSON.parse(typeof body === 'string' ? body : body.toString('utf8')) as unknown
  } catch {
    throw invalidClientMetadata('registration metadata must be valid JSON')
  }
}

export function requiredFormValue(form: URLSearchParams, name: string): string {
  const value = form.get(name)
  if (!value) throw invalidRequest(`${name} is required`)
  return value
}

/**
 * Reads client credentials from HTTP Basic or, for public clients, a bare `client_id`.
 * `client_secret_post` and mixing both methods are rejected.
 */
export function parseClientAuthentication(
  authorization: string | undefined,
  form: URLSearchParams,
): ClientCredentials {
  const bodyClientId = form.get('client_id')
  const bodyClientSecret = form.get('client_secret')
  if (!authorization) {
    if (!bodyClientId) throw invalidClient('client_id is required')
    if (bodyClientSecret !== null) throw invalidClient('client_secret_post is not supported')
    return { clientId: bodyClientId }
  }
  const match = /^basic +(.+)$/i.exec(authorization)
  if (!match || bodyClientId || bodyClientSecret !== null) throw invalidClient()
  const decoded = decodeBasicCredentials(match[1]!)
  const separator = decoded.indexOf(':')
  if (separator < 1) throw invalidClient()
  return {
    clientId: decodeFormComponent(decoded.slice(0, separator)),
    clientSecret: decodeFormComponent(decoded.slice(separator + 1)),
  }
}

function decodeBasicCredentials(encoded: string): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw invalidClient()
  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  if (decoded.includes('�')) throw invalidClient()
  return decoded
}

function decodeFormComponent(value: string): string {
  try {
    return decodeURIComponent(value.replaceAll('+', ' '))
  } catch {
    throw invalidClient()
  }
}
