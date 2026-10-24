import { generateKeyPairSync } from 'node:crypto'
import type {
  NodeSavedSession,
  NodeSavedSessionStore,
  NodeSavedState,
  NodeSavedStateStore,
} from '@atproto/oauth-client-node'

export function makeJwk(kid: string): Record<string, string> {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return { ...(privateKey.export({ format: 'jwk' }) as Record<string, string>), alg: 'ES256', kid }
}

export function toEnv(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

function memoryStore<T>() {
  const store = new Map<string, T>()
  return {
    get: async (key: string) => store.get(key),
    set: async (key: string, value: T) => void store.set(key, value),
    del: async (key: string) => void store.delete(key),
  }
}

export const stateStore = (): NodeSavedStateStore => memoryStore<NodeSavedState>()
export const sessionStore = (): NodeSavedSessionStore => memoryStore<NodeSavedSession>()

import type { AtprotoOAuthClientOptions } from './create-client.mts'

export function makeMetadata(jwks: unknown): AtprotoOAuthClientOptions['clientMetadata'] {
  return {
    client_id: 'https://app.example.com/client-metadata.json',
    client_name: 'Example App',
    client_uri: 'https://app.example.com',
    redirect_uris: ['https://app.example.com/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'atproto',
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    dpop_bound_access_tokens: true,
    application_type: 'web',
    jwks,
  } as never
}
