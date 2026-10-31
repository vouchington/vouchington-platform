import { createHash } from 'node:crypto'
import { createScopeCatalog } from '@vouchington/utils/scopes'
import type {
  AuthorizationCodeGrant,
  AuthorizationCodeRecord,
  ClientRegistry,
  GrantStore,
  HashSecret,
  IssuedTokens,
  NewOAuthClient,
  OAuthClient,
  ProtectedResource,
  RefreshTokenRecord,
  ScopePolicy,
} from './types.mts'

export const NOW = new Date('2026-01-01T00:00:00.000Z')
export const USER_RESOURCE = 'https://api.example.test/mcp'
export const ADMIN_RESOURCE = 'https://api.example.test/admin/mcp'

const catalog = createScopeCatalog({
  'mcp.user:read': { audience: 'user', surfaces: ['oauth'] },
  'mcp.user:write': { audience: 'user', surfaces: ['oauth'], covers: ['mcp.user:read'] },
  'mcp.admin:read': { audience: 'admin', surfaces: ['oauth'] },
  'web:only': { audience: 'user', surfaces: ['web'] },
})

export const policy: ScopePolicy = { catalog, surface: 'oauth' }

export const hashSecret: HashSecret = (purpose, value) =>
  createHash('sha256').update(`${purpose}:${value}`).digest('hex')

export function resolveResource(value: string): ProtectedResource | null {
  if (value === USER_RESOURCE) return { url: value, audience: 'user' }
  if (value === ADMIN_RESOURCE) return { url: value, audience: 'admin' }
  return null
}

export function makeClient(overrides: Partial<OAuthClient> = {}): OAuthClient {
  return {
    clientId: 'client-1',
    clientName: 'Example',
    redirectUris: ['https://app.example.test/callback'],
    scopes: ['mcp.user:write'],
    tokenEndpointAuthMethod: 'none',
    clientSecretHash: null,
    ...overrides,
  }
}

export function makeConfidentialClient(secret = 'shh'): OAuthClient {
  return makeClient({
    clientId: 'confidential',
    tokenEndpointAuthMethod: 'client_secret_basic',
    clientSecretHash: hashSecret('client-secret', secret),
  })
}

export interface MemoryStore extends ClientRegistry, GrantStore {
  clients: Map<string, OAuthClient>
  created: Array<{ client: NewOAuthClient; context: unknown }>
  codes: Map<string, AuthorizationCodeRecord>
  refresh: Map<string, RefreshTokenRecord>
  tokens: IssuedTokens[]
  revoked: Array<{ hash: string; clientId: string }>
  persist(tokens: IssuedTokens): void
}

/** In-memory stores that honor the single-use consume contract. */
export function createMemoryStore(clients: OAuthClient[] = []): MemoryStore {
  const store: MemoryStore = {
    clients: new Map(clients.map((client) => [client.clientId, client])),
    created: [],
    codes: new Map(),
    refresh: new Map(),
    tokens: [],
    revoked: [],
    findClient: async (clientId) => store.clients.get(clientId) ?? null,
    createClient: async (client, context) => {
      store.created.push({ client, context })
      store.clients.set(client.clientId, client)
    },
    saveAuthorizationCode: async (code: AuthorizationCodeGrant) => {
      store.codes.set(code.codeHash, { ...code, replayed: false })
    },
    redeemAuthorizationCode: async (codeHash, redeem) => {
      const record = store.codes.get(codeHash)
      if (record) store.codes.set(codeHash, { ...record, replayed: true })
      store.persist(await redeem(record ? { ...record } : null))
    },
    redeemRefreshToken: async (tokenHash, redeem) => {
      const record = store.refresh.get(tokenHash)
      if (record) store.refresh.set(tokenHash, { ...record, replayed: true })
      store.persist(await redeem(record ? { ...record } : null))
    },
    persist: (tokens) => {
      store.tokens.push(tokens)
      store.refresh.set(tokens.refreshTokenHash, {
        clientId: tokens.clientId,
        grantId: tokens.grantId,
        subject: tokens.subject,
        familyId: tokens.familyId,
        generation: tokens.generation,
        resource: tokens.resource,
        scopes: tokens.refreshScopes,
        familyExpiresAt: tokens.refreshExpiresAt,
        expiresAt: tokens.refreshExpiresAt,
        revoked: false,
        replayed: false,
      })
    },
    revokeToken: async (hash, clientId) => {
      store.revoked.push({ hash, clientId })
    },
  }
  return store
}
