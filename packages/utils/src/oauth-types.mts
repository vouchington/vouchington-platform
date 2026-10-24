/** Injected transport. Egress guards, dispatchers and timeouts belong to the caller. */
export type OAuthFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface OAuthProfile {
  providerUserId: string
  /** Only set when the provider asserts the address is verified. */
  verifiedEmail: string | null
  data: Record<string, unknown>
}
