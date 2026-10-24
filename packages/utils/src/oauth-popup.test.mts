import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OAuthCancelledError,
  buildAuthorizationUrl,
  openOAuthPopup,
  runPopupOAuthLogin,
} from './oauth-popup.mts'
import { makeFakeWindow } from './oauth-popup-test-helpers.mts'

const base = {
  authUrl: new URL('https://idp.example.com/oauth'),
  popupName: 'github-oauth',
  provider: 'github',
  providerLabel: 'GitHub',
  state: 'state-123',
}

describe('OAuthCancelledError', () => {
  it('uses the provider label or an explicit reason', () => {
    expect(new OAuthCancelledError('GitHub').message).toBe('GitHub login cancelled')
    expect(new OAuthCancelledError('GitHub', 'Popup blocked').message).toBe('Popup blocked')
    expect(new OAuthCancelledError('GitHub').name).toBe('OAuthCancelledError')
  })
})

describe('openOAuthPopup', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('resolves with the code and cleans up listeners and timers', async () => {
    const fake = makeFakeWindow()
    const result = openOAuthPopup({ ...base, window: fake.win })
    expect(fake.opened[0]).toEqual({
      url: 'https://idp.example.com/oauth',
      name: 'github-oauth',
      features: 'width=600,height=700',
    })
    fake.post({ data: { provider: 'github', code: 'code-1', state: 'state-123' } })
    await expect(result).resolves.toEqual({ code: 'code-1' })
    expect(fake.listenerCount()).toBe(0)
    expect(fake.intervalCount()).toBe(0)
    fake.post({ data: { provider: 'github', code: 'late', state: 'state-123' } })
  })

  it('accepts string URLs and custom features', async () => {
    const fake = makeFakeWindow()
    const result = openOAuthPopup({
      ...base,
      authUrl: 'https://idp.example.com/x',
      features: 'width=1',
      pollMs: 10,
      window: fake.win,
    })
    expect(fake.opened[0]).toMatchObject({ url: 'https://idp.example.com/x', features: 'width=1' })
    fake.post({ data: { provider: 'github', code: 'c', state: 'state-123' } })
    await expect(result).resolves.toEqual({ code: 'c' })
  })

  it('rejects when the popup is blocked', async () => {
    const fake = makeFakeWindow({ blocked: true })
    await expect(openOAuthPopup({ ...base, window: fake.win })).rejects.toThrow('Popup blocked')
    expect(fake.listenerCount()).toBe(0)
  })

  it('rejects when the popup closes and keeps polling while open', async () => {
    const fake = makeFakeWindow()
    const result = openOAuthPopup({ ...base, window: fake.win })
    const settled = result.catch((error: unknown) => error)
    fake.tick()
    expect(fake.intervalCount()).toBe(1)
    fake.popup.closed = true
    fake.tick()
    await expect(settled).resolves.toBeInstanceOf(OAuthCancelledError)
    expect(fake.listenerCount()).toBe(0)
  })

  it('ignores other origins, sources, providers and missing data', async () => {
    const fake = makeFakeWindow()
    const result = openOAuthPopup({ ...base, window: fake.win })
    const good = { provider: 'github', code: 'ok', state: 'state-123' }
    fake.post({ origin: 'https://evil.example.com', data: good })
    fake.post({ source: {}, data: good })
    fake.post({ data: { ...good, provider: 'linkedin' } })
    fake.post({ data: null })
    expect(fake.listenerCount()).toBe(1)
    fake.post({ data: good })
    await expect(result).resolves.toEqual({ code: 'ok' })
  })

  it('rejects on a state mismatch or a missing code', async () => {
    const mismatch = makeFakeWindow()
    const first = openOAuthPopup({ ...base, window: mismatch.win })
    mismatch.post({ data: { provider: 'github', code: 'c', state: 'other' } })
    await expect(first).rejects.toBeInstanceOf(OAuthCancelledError)

    const missing = makeFakeWindow()
    const second = openOAuthPopup({ ...base, window: missing.win })
    missing.post({ data: { provider: 'github', state: 'state-123' } })
    await expect(second).rejects.toBeInstanceOf(OAuthCancelledError)
  })

  it('defaults to globalThis.window', async () => {
    const fake = makeFakeWindow()
    vi.stubGlobal('window', fake.win)
    const result = openOAuthPopup(base)
    fake.post({ data: { provider: 'github', code: 'g', state: 'state-123' } })
    await expect(result).resolves.toEqual({ code: 'g' })
  })
})

describe('buildAuthorizationUrl', () => {
  const options = {
    authUrl: 'https://idp.example.com/authorize?existing=1',
    clientId: 'client',
    redirectUri: 'https://app.example.com/cb',
    scope: 'openid email',
    state: 's',
  }

  it('sets the required parameters only', () => {
    const url = buildAuthorizationUrl(options)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      existing: '1',
      client_id: 'client',
      redirect_uri: 'https://app.example.com/cb',
      scope: 'openid email',
      state: 's',
    })
  })

  it('adds response type, response mode and S256 PKCE parameters', () => {
    const url = buildAuthorizationUrl({
      ...options,
      authUrl: new URL(options.authUrl),
      responseType: 'code',
      responseMode: 'form_post',
      codeChallenge: 'challenge',
    })
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('response_mode')).toBe('form_post')
    expect(url.searchParams.get('code_challenge')).toBe('challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('runPopupOAuthLogin', () => {
  const config = {
    clientId: 'client',
    authUrl: 'https://idp.example.com/authorize',
    callbackPath: '/callback',
    popupName: 'p',
    provider: 'github',
    providerLabel: 'GitHub',
    scope: 'read',
  }

  const navigated = (fake: ReturnType<typeof makeFakeWindow>) =>
    vi.waitFor(() => expect(fake.popup.location.href).not.toBe('about:blank'))

  async function run(extra: Record<string, unknown>) {
    const fake = makeFakeWindow()
    const mapResult = vi.fn((result: unknown) => result)
    const login = runPopupOAuthLogin({ ...config, ...extra, mapResult, window: fake.win })
    await navigated(fake)
    const url = new URL(fake.popup.location.href)
    fake.post({
      data: { provider: 'github', code: 'the-code', state: url.searchParams.get('state')! },
    })
    return { result: await login, url, mapResult, fake }
  }

  it('opens a blank popup and navigates it without PKCE', async () => {
    const { result, url, fake } = await run({})
    expect(fake.opened).toEqual([
      { url: 'about:blank', name: 'p', features: 'width=600,height=700' },
    ])
    expect(result).toEqual({ code: 'the-code', redirectUri: 'https://app.example.com/callback' })
    expect(url.searchParams.has('code_challenge')).toBe(false)
    expect(url.searchParams.has('response_type')).toBe(false)
    expect(fake.closeCalls()).toBe(0)
  })

  it('opens the popup synchronously, before the PKCE challenge resolves', async () => {
    const fake = makeFakeWindow()
    const login = runPopupOAuthLogin({
      ...config,
      pkce: true,
      mapResult: (r) => r,
      window: fake.win,
    })
    expect(fake.opened).toHaveLength(1)
    expect(fake.popup.location.href).toBe('about:blank')
    await navigated(fake)
    const url = new URL(fake.popup.location.href)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    fake.post({ data: { provider: 'github', code: 'c', state: url.searchParams.get('state')! } })
    await expect(login).resolves.toMatchObject({
      codeVerifier: expect.stringMatching(/^[\w-]{43}$/),
    })
  })

  it('passes the verifier, response type/mode and a dynamic auth URL', async () => {
    const { result, url } = await run({
      authUrl: () => 'https://idp.example.com/dynamic',
      pkce: true,
      responseType: 'code',
      responseMode: 'query',
    })
    expect(url.pathname).toBe('/dynamic')
    expect(url.searchParams.get('response_mode')).toBe('query')
    expect(result).toMatchObject({ code: 'the-code' })
  })

  it('rejects immediately when the popup is blocked', async () => {
    const fake = makeFakeWindow({ blocked: true })
    const login = runPopupOAuthLogin({
      ...config,
      pkce: true,
      mapResult: (r) => r,
      window: fake.win,
    })
    await expect(login).rejects.toThrow('Popup blocked')
    expect(fake.listenerCount()).toBe(0)
  })

  it('closes the blank popup when building the URL throws', async () => {
    const fake = makeFakeWindow()
    const login = runPopupOAuthLogin({
      ...config,
      pkce: true,
      authUrl: () => 'not a url',
      mapResult: (r) => r,
      window: fake.win,
    })
    await expect(login).rejects.toThrow()
    expect(fake.closeCalls()).toBe(1)
    expect(fake.popup.location.href).toBe('about:blank')
    expect(fake.listenerCount()).toBe(0)
  })

  it('closes the blank popup when the challenge step throws', async () => {
    const fake = makeFakeWindow()
    const digest = vi
      .spyOn(crypto.subtle, 'digest')
      .mockRejectedValueOnce(new Error('digest failed'))
    const login = runPopupOAuthLogin({
      ...config,
      pkce: true,
      mapResult: (r) => r,
      window: fake.win,
    })
    await expect(login).rejects.toThrow('digest failed')
    expect(fake.closeCalls()).toBe(1)
    digest.mockRestore()
  })

  it('defaults to globalThis.window', async () => {
    const fake = makeFakeWindow()
    vi.stubGlobal('window', fake.win)
    const login = runPopupOAuthLogin({ ...config, mapResult: (r) => r.redirectUri })
    await navigated(fake)
    const state = new URL(fake.popup.location.href).searchParams.get('state')!
    fake.post({ data: { provider: 'github', code: 'c', state } })
    await expect(login).resolves.toBe('https://app.example.com/callback')
    vi.unstubAllGlobals()
  })
})
