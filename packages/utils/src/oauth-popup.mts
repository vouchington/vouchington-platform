import { generateCodeChallenge, generateCodeVerifier, generateState } from './oauth-pkce.mts'

export class OAuthCancelledError extends Error {
  constructor(providerLabel: string, reason?: string) {
    super(reason ?? `${providerLabel} login cancelled`)
    this.name = 'OAuthCancelledError'
  }
}

export interface OAuthPopupHandle {
  readonly closed: boolean
}

export interface OAuthPopupMessageEvent {
  readonly origin: string
  readonly source: unknown
  readonly data?: { provider?: string; code?: string; state?: string } | null
}

/** The slice of `window` the popup flow uses; injectable for tests and non-DOM hosts. */
export interface OAuthPopupWindow {
  readonly location: { readonly origin: string }
  open(url: string, name: string, features: string): OAuthPopupHandle | null
  addEventListener(type: 'message', listener: (event: OAuthPopupMessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: OAuthPopupMessageEvent) => void): void
  setInterval(callback: () => void, ms: number): number
  clearInterval(id: number): void
}

export interface OpenOAuthPopupOptions {
  authUrl: URL | string
  popupName: string
  provider: string
  providerLabel: string
  state: string
  /** Defaults to `width=600,height=700`. */
  features?: string
  /** Popup-closed poll interval; defaults to 500. */
  pollMs?: number
  /** Defaults to `globalThis.window`. */
  window?: OAuthPopupWindow
}

function defaultWindow(): OAuthPopupWindow {
  return (globalThis as unknown as { window: OAuthPopupWindow }).window
}

/** Resolves with the authorization code posted back by the same-origin popup. */
export function openOAuthPopup(options: OpenOAuthPopupOptions): Promise<{ code: string }> {
  const { authUrl, popupName, provider, providerLabel, state } = options
  const win = options.window ?? defaultWindow()
  return new Promise((resolve, reject) => {
    const popup = win.open(
      authUrl.toString(),
      popupName,
      options.features ?? 'width=600,height=700',
    )
    if (!popup) {
      reject(new OAuthCancelledError(providerLabel, 'Popup blocked'))
      return
    }

    const finish = (callback: () => void): void => {
      win.clearInterval(checkClosed)
      win.removeEventListener('message', handleMessage)
      callback()
    }
    const handleMessage = (event: OAuthPopupMessageEvent): void => {
      if (event.origin !== win.location.origin) return
      if (event.source !== popup) return
      if (event.data?.provider !== provider) return
      const { code } = event.data
      if (code && event.data.state === state) {
        finish(() => resolve({ code }))
        return
      }
      finish(() => reject(new OAuthCancelledError(providerLabel)))
    }
    win.addEventListener('message', handleMessage)
    const checkClosed = win.setInterval(() => {
      if (popup.closed) finish(() => reject(new OAuthCancelledError(providerLabel)))
    }, options.pollMs ?? 500)
  })
}

export interface BuildAuthorizationUrlOptions {
  authUrl: string | URL
  clientId: string
  redirectUri: string
  scope: string
  state: string
  responseType?: string
  responseMode?: string
  /** Adds `code_challenge` and `code_challenge_method=S256` when set. */
  codeChallenge?: string
}

export function buildAuthorizationUrl(options: BuildAuthorizationUrlOptions): URL {
  const url = new URL(options.authUrl)
  const params = url.searchParams
  if (options.responseType) params.set('response_type', options.responseType)
  params.set('client_id', options.clientId)
  params.set('redirect_uri', options.redirectUri)
  params.set('scope', options.scope)
  params.set('state', options.state)
  if (options.responseMode) params.set('response_mode', options.responseMode)
  if (options.codeChallenge) {
    params.set('code_challenge', options.codeChallenge)
    params.set('code_challenge_method', 'S256')
  }
  return url
}

export interface PopupOAuthLoginConfig<T> {
  clientId: string
  authUrl: string | (() => string)
  callbackPath: string
  popupName: string
  provider: string
  providerLabel: string
  scope: string
  responseType?: string
  responseMode?: string
  pkce?: boolean
  mapResult(result: { code: string; codeVerifier?: string; redirectUri: string }): T
  /** Defaults to `globalThis.window`. */
  window?: OAuthPopupWindow
}

/** Generates state (and PKCE), opens the popup, and maps the redeemed code. No in-flight guard. */
export async function runPopupOAuthLogin<T>(config: PopupOAuthLoginConfig<T>): Promise<T> {
  const win = config.window ?? defaultWindow()
  const state = generateState()
  const redirectUri = `${win.location.origin}${config.callbackPath}`
  const codeVerifier = config.pkce ? generateCodeVerifier() : undefined
  const codeChallenge = codeVerifier ? await generateCodeChallenge(codeVerifier) : undefined
  const authUrl = buildAuthorizationUrl({
    authUrl: typeof config.authUrl === 'function' ? config.authUrl() : config.authUrl,
    clientId: config.clientId,
    redirectUri,
    scope: config.scope,
    state,
    ...(config.responseType ? { responseType: config.responseType } : {}),
    ...(config.responseMode ? { responseMode: config.responseMode } : {}),
    ...(codeChallenge ? { codeChallenge } : {}),
  })
  const { code } = await openOAuthPopup({
    authUrl,
    popupName: config.popupName,
    provider: config.provider,
    providerLabel: config.providerLabel,
    state,
    window: win,
  })
  return config.mapResult({ code, ...(codeVerifier ? { codeVerifier } : {}), redirectUri })
}
