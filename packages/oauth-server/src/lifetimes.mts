import type { TokenLifetimes, TokenPrefixes } from './types.mts'

/** Safe defaults; callers override any of them. */
export const DEFAULT_TOKEN_LIFETIMES: TokenLifetimes = {
  authorizationCodeMs: 5 * 60 * 1000,
  accessTokenMs: 60 * 60 * 1000,
  refreshTokenMs: 30 * 24 * 60 * 60 * 1000,
}

export const DEFAULT_TOKEN_PREFIXES: TokenPrefixes = {
  authorizationCode: 'code_',
  accessToken: 'access_',
  refreshToken: 'refresh_',
}
