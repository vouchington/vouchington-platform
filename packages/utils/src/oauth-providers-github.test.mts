import { describe, expect, it } from 'vitest'
import { githubProvider } from './oauth-providers.mts'
import { failure, input, json, routeFetch } from './oauth-providers-test-helpers.mts'

const provider = githubProvider({ clientId: 'id', clientSecret: 'secret' })
const TOKEN = 'https://github.com/login/oauth/access_token'
const USER = 'https://api.github.com/user'
const EMAILS = 'https://api.github.com/user/emails'

const emails = [
  { email: 'old@example.com', primary: false, verified: true },
  { email: 'unverified@example.com', primary: true, verified: false },
  'junk',
  { email: 'me@example.com', primary: true, verified: true },
]

function routes(overrides: Record<string, Response> = {}) {
  return routeFetch({
    [TOKEN]: json({ access_token: 'gh-token', token_type: 'bearer', expires_in: 60 }),
    [EMAILS]: json(emails),
    [USER]: json({ id: 42, login: 'octo', name: null, avatar_url: 'https://example.com/a.png' }),
    ...overrides,
  })
}

describe('githubProvider', () => {
  it('exchanges the code with a JSON body and returns the verified primary email', async () => {
    const { ctx, init, urls } = routes()
    const result = await provider.redeem(input, ctx())
    expect(provider.id).toBe('github')
    expect(init(0)).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    })
    expect(JSON.parse(init(0).body as string)).toEqual({
      client_id: 'id',
      client_secret: 'secret',
      code: 'auth-code',
      redirect_uri: input.redirectUri,
      code_verifier: 'verifier-1',
    })
    expect(init(1)).toEqual({
      headers: { Authorization: 'Bearer gh-token', Accept: 'application/vnd.github+json' },
    })
    expect(urls()).toEqual([TOKEN, USER, EMAILS])
    expect(result).toEqual({
      tokens: { accessToken: 'gh-token' },
      profile: {
        providerUserId: '42',
        verifiedEmail: 'me@example.com',
        data: { login: 'octo', name: 'octo', avatar_url: 'https://example.com/a.png' },
      },
    })
  })

  it('omits the verifier and avatar, and accepts a string id and display name', async () => {
    const { ctx, init } = routes({
      [USER]: json({ id: 'abc', login: 'octo', name: 'Octo Cat' }),
      [EMAILS]: json([{ email: 'x@example.com', primary: true, verified: false }]),
    })
    const result = await provider.redeem({ code: 'c', redirectUri: 'r' }, ctx())
    expect(JSON.parse(init(0).body as string)).not.toHaveProperty('code_verifier')
    expect(result.profile).toEqual({
      providerUserId: 'abc',
      verifiedEmail: null,
      data: { login: 'octo', name: 'Octo Cat' },
    })
  })

  it('forwards the abort signal to every request', async () => {
    const { ctx, fetch } = routes()
    const signal = new AbortController().signal
    await provider.redeem(input, ctx({ signal }))
    expect(fetch.mock.calls.map((call) => call[1]?.signal)).toEqual([signal, signal, signal])
  })

  it.each([
    ['token endpoint', TOKEN, 401],
    ['/user', USER, 500],
    ['/user/emails', EMAILS, 403],
  ])('throws an http error when %s fails', async (_name, url, status) => {
    const { ctx } = routes({ [url]: json({}, status) })
    const error = await failure(provider.redeem(input, ctx()))
    expect(error).toMatchObject({ provider: 'github', kind: 'http', status })
  })

  it('throws a provider error for an error body', async () => {
    const { ctx } = routes({ [TOKEN]: json({ error: 'bad_verification_code' }) })
    expect(await failure(provider.redeem(input, ctx()))).toMatchObject({ kind: 'provider_error' })
  })

  it('throws malformed errors for a missing token, id, or email list', async () => {
    for (const override of [
      { [TOKEN]: json({}) },
      { [USER]: json({ login: 'octo' }) },
      { [USER]: json([]) },
      { [EMAILS]: json({ not: 'a list' }) },
    ]) {
      const { ctx } = routes(override)
      expect(await failure(provider.redeem(input, ctx()))).toMatchObject({ kind: 'malformed' })
    }
  })
})
