export type AuthErrorCode =
  | 'challenge_expired'
  | 'invalid_credentials'
  | 'invalid_request'
  | 'rate_limited'

export class AuthError extends Error {
  readonly code: AuthErrorCode
  readonly status: number

  constructor(code: AuthErrorCode, status: number, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}
