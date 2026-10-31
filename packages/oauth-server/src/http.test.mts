import { describe, expect, it } from 'vitest'
import {
  OAuthProtocolError,
  buildAuthorizationResponseUrl,
  buildAuthorizationServerMetadata,
  buildOAuthErrorResponse,
  buildProtectedResourceMetadata,
  OAUTH_RESPONSE_HEADERS,
  parseClientAuthentication,
  parseFormBody,
  parseRegistrationBody,
  protectedResourceMetadataUrl,
  requiredFormValue,
} from './index.mts'

const FORM = 'application/x-www-form-urlencoded'
const basic = (value: string) => `Basic ${Buffer.from(value).toString('base64')}`

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    return (err as OAuthProtocolError).code
  }
  return 'none'
}

describe('request parsing', () => {
  it('parses form bodies from strings and buffers', () => {
    expect(parseFormBody(`${FORM}; charset=UTF-8`, 'a=1&b=2').get('b')).toBe('2')
    expect(parseFormBody(FORM.toUpperCase(), Buffer.from('a=1')).get('a')).toBe('1')
  })

  it('rejects other media types and repeated parameters', () => {
    expect(code(() => parseFormBody(undefined, 'a=1'))).toBe('invalid_request')
    expect(code(() => parseFormBody('application/json', 'a=1'))).toBe('invalid_request')
    expect(() => parseFormBody(FORM, 'a=1&a=2')).toThrow('a must not be repeated')
  })

  it('parses registration JSON', () => {
    expect(parseRegistrationBody('application/json', '{"a":1}')).toEqual({ a: 1 })
    expect(parseRegistrationBody('application/json', Buffer.from('[]'))).toEqual([])
    expect(code(() => parseRegistrationBody(FORM, '{}'))).toBe('invalid_client_metadata')
    expect(code(() => parseRegistrationBody('application/json', '{'))).toBe(
      'invalid_client_metadata',
    )
  })

  it('requires non-empty form values', () => {
    const form = new URLSearchParams('a=1&b=')
    expect(requiredFormValue(form, 'a')).toBe('1')
    expect(code(() => requiredFormValue(form, 'b'))).toBe('invalid_request')
    expect(code(() => requiredFormValue(form, 'c'))).toBe('invalid_request')
  })
})

describe('client authentication parsing', () => {
  it('accepts a bare client_id for public clients', () => {
    expect(parseClientAuthentication(undefined, new URLSearchParams('client_id=abc'))).toEqual({
      clientId: 'abc',
    })
  })

  it('rejects missing ids and client_secret_post', () => {
    const none = new URLSearchParams()
    expect(code(() => parseClientAuthentication(undefined, none))).toBe('invalid_client')
    const post = new URLSearchParams('client_id=a&client_secret=b')
    expect(() => parseClientAuthentication(undefined, post)).toThrow('client_secret_post')
  })

  it('decodes HTTP Basic credentials per RFC 6749 section 2.3.1', () => {
    expect(parseClientAuthentication(basic('id%3A1:p+w%25'), new URLSearchParams())).toEqual({
      clientId: 'id:1',
      clientSecret: 'p w%',
    })
    expect(
      parseClientAuthentication(`basic   ${basic('a:b').slice(6)}`, new URLSearchParams()),
    ).toEqual({
      clientId: 'a',
      clientSecret: 'b',
    })
  })

  it.each([
    ['bearer scheme', 'Bearer abc', ''],
    ['body client_id', basic('a:b'), 'client_id=a'],
    ['body client_secret', basic('a:b'), 'client_secret=b'],
    ['non-base64', 'Basic !!!!', ''],
    ['bad padding length', 'Basic YQ', ''],
    ['invalid utf-8', 'Basic //4=', ''],
    ['no separator', basic('nocolon'), ''],
    ['empty id', basic(':secret'), ''],
    ['bad percent encoding', basic('a:%E0%A4%A'), ''],
  ])('rejects %s', (_name, header, body) => {
    const err = () => parseClientAuthentication(header, new URLSearchParams(body))
    expect(code(err)).toBe('invalid_client')
    try {
      err()
    } catch (e) {
      expect((e as OAuthProtocolError).status).toBe(401)
    }
  })
})

describe('responses and metadata', () => {
  it('renders RFC 6749 error responses', () => {
    const response = buildOAuthErrorResponse(new OAuthProtocolError('invalid_grant', 'nope'))
    expect(response).toEqual({
      status: 400,
      headers: { ...OAUTH_RESPONSE_HEADERS },
      body: { error: 'invalid_grant', error_description: 'nope' },
    })
    expect(response.headers['Cache-Control']).toBe('no-store')
  })

  it('adds a Basic challenge for invalid_client', () => {
    const error = new OAuthProtocolError('invalid_client', 'bad', 401)
    expect(buildOAuthErrorResponse(error).headers['WWW-Authenticate']).toBe('Basic realm="token"')
    expect(buildOAuthErrorResponse(error, 'r').headers['WWW-Authenticate']).toBe('Basic realm="r"')
  })

  it('escapes the Basic realm as a quoted-string and rejects control characters', () => {
    const error = new OAuthProtocolError('invalid_client', 'bad', 401)
    expect(buildOAuthErrorResponse(error, 'a"b\\c').headers['WWW-Authenticate']).toBe(
      'Basic realm="a\\"b\\\\c"',
    )
    expect(() => buildOAuthErrorResponse(error, 'a\nb')).toThrow(TypeError)
  })

  it('always appends iss to authorization responses', () => {
    const url = new URL(
      buildAuthorizationResponseUrl(
        'https://a.test/cb?x=1',
        { code: 'c', state: 's' },
        'https://as.test',
      ),
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      x: '1',
      code: 'c',
      state: 's',
      iss: 'https://as.test',
    })
  })

  it('builds RFC 8414 metadata with defaults, overrides, and extras', () => {
    const metadata = buildAuthorizationServerMetadata({
      issuer: 'https://as.test',
      scopesSupported: ['b', 'a'],
    })
    expect(metadata).toMatchObject({
      authorization_endpoint: 'https://as.test/authorize',
      token_endpoint: 'https://as.test/token',
      registration_endpoint: 'https://as.test/register',
      revocation_endpoint: 'https://as.test/revoke',
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['a', 'b'],
      authorization_response_iss_parameter_supported: true,
    })
    const slashed = buildAuthorizationServerMetadata({
      issuer: 'https://as.test//',
      scopesSupported: [],
    })
    expect(slashed).toMatchObject({
      issuer: 'https://as.test//',
      authorization_endpoint: 'https://as.test/authorize',
      revocation_endpoint: 'https://as.test/revoke',
    })
    const custom = buildAuthorizationServerMetadata({
      issuer: 'https://as.test',
      scopesSupported: [],
      endpoints: {
        authorization: 'https://as.test/a',
        token: 'https://as.test/t',
        registration: 'https://as.test/r',
        revocation: 'https://as.test/v',
      },
      extra: { client_id_metadata_document_supported: true },
    })
    expect(custom).toMatchObject({
      authorization_endpoint: 'https://as.test/a',
      token_endpoint: 'https://as.test/t',
      registration_endpoint: 'https://as.test/r',
      revocation_endpoint: 'https://as.test/v',
      client_id_metadata_document_supported: true,
    })
  })

  it('builds RFC 9728 documents and path-inserted URLs', () => {
    expect(
      buildProtectedResourceMetadata({
        resource: 'https://api.test/mcp',
        issuer: 'https://as.test',
        scopesSupported: ['z', 'a'],
      }),
    ).toEqual({
      resource: 'https://api.test/mcp',
      authorization_servers: ['https://as.test'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['a', 'z'],
    })
    expect(protectedResourceMetadataUrl('https://api.test/api/mcp')).toBe(
      'https://api.test/.well-known/oauth-protected-resource/api/mcp',
    )
    expect(protectedResourceMetadataUrl('https://api.test/mcp?tenant=a')).toBe(
      'https://api.test/.well-known/oauth-protected-resource/mcp?tenant=a',
    )
    expect(protectedResourceMetadataUrl('https://api.test')).toBe(
      'https://api.test/.well-known/oauth-protected-resource',
    )
  })
})
