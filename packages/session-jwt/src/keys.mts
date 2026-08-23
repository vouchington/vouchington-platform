import * as jose from 'jose'

export const JWT_ALGORITHM = 'RS512'
export const MIN_RSA_MODULUS_BITS = 2048
export type ManagedJwk = Readonly<jose.JWK & { alg: typeof JWT_ALGORITHM; kid: string }>
export type ImportedJwtKey = Readonly<{ cryptoKey: jose.CryptoKey; jwk: ManagedJwk }>
export type JwtKeySet = Readonly<{
  privateKeys: readonly ImportedJwtKey[]
  publicKeys: readonly ImportedJwtKey[]
}>
export type JwtKeySetOptions = Readonly<{
  privateJwks?: readonly jose.JWK[]
  publicJwks?: readonly jose.JWK[]
}>

const PRIVATE_RSA_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi'] as const

export function derivePublicJwk(privateJwk: jose.JWK): jose.JWK {
  const {
    d: _d,
    p: _p,
    q: _q,
    dp: _dp,
    dq: _dq,
    qi: _qi,
    oth: _oth,
    key_ops: keyOperations,
    ...publicJwk
  } = privateJwk
  return cloneAndFreezeJwk({
    ...publicJwk,
    ...(keyOperations === undefined ? {} : { key_ops: ['verify'] }),
  })
}

export function parseJwkSet(value: unknown, label: string): readonly ManagedJwk[] {
  const keys = Array.isArray(value)
    ? value
    : typeof value === 'object' &&
        value !== null &&
        Array.isArray((value as { keys?: unknown }).keys)
      ? (value as { keys: unknown[] }).keys
      : [value]
  if (keys.length === 0) throw new Error(`${label} must contain at least one JWK`)
  const kids = new Set<string>()
  return Object.freeze(
    keys.map((value, index) => {
      if (typeof value !== 'object' || value === null)
        throw new Error(`${label}[${index}] must be a JWK`)
      const jwk = value as jose.JWK
      if (jwk.kty !== 'RSA') throw new Error(`${label}[${index}] must be an RSA JWK`)
      if (jwk.alg !== JWT_ALGORITHM) throw new Error(`${label}[${index}] must use ${JWT_ALGORITHM}`)
      if (jwk.use !== undefined && jwk.use !== 'sig')
        throw new Error(`${label}[${index}] must be a signature key`)
      if (
        jwk.key_ops !== undefined &&
        (!Array.isArray(jwk.key_ops) || jwk.key_ops.some((value) => typeof value !== 'string'))
      )
        throw new Error(`${label}[${index}] has invalid key_ops`)
      if (typeof jwk.kid !== 'string' || jwk.kid.trim().length === 0)
        throw new Error(`${label}[${index}] is missing kid`)
      if (kids.has(jwk.kid)) throw new Error(`${label} contains duplicate kid values: ${jwk.kid}`)
      assertRsaPublicMembers(jwk, label, index)
      kids.add(jwk.kid)
      return cloneAndFreezeJwk(jwk) as ManagedJwk
    }),
  )
}

export async function createJwtKeySet(options: JwtKeySetOptions): Promise<JwtKeySet> {
  if (!options.privateJwks?.length && !options.publicJwks?.length)
    throw new Error('JWT key sets require private or public JWKs')
  const privateJwks = options.privateJwks ? parseJwkSet(options.privateJwks, 'privateJwks') : []
  privateJwks.forEach((jwk, index) => assertJwkRole(jwk, 'privateJwks', index, 'sign'))
  const publicJwks = options.publicJwks
    ? parseJwkSet(options.publicJwks, 'publicJwks')
    : privateJwks.map((jwk) => derivePublicJwk(jwk) as ManagedJwk)
  publicJwks.forEach((jwk, index) => assertJwkRole(jwk, 'publicJwks', index, 'verify'))
  const [privateKeys, publicKeys] = await Promise.all([
    importKeys(privateJwks, 'privateJwks'),
    importKeys(publicJwks, 'publicJwks'),
  ])
  return Object.freeze({ privateKeys, publicKeys })
}

export class JwtKeySetCache {
  private byOptions = new WeakMap<JwtKeySetOptions, Promise<JwtKeySet>>()

  getOrCreate(options: JwtKeySetOptions): Promise<JwtKeySet> {
    const cached = this.byOptions.get(options)
    if (cached) return cached
    const created = createJwtKeySet(options)
    this.byOptions.set(options, created)
    void created.catch(() => {
      if (this.byOptions.get(options) === created) this.byOptions.delete(options)
    })
    return created
  }

  delete(options: JwtKeySetOptions): boolean {
    return this.byOptions.delete(options)
  }

  clear(): void {
    this.byOptions = new WeakMap()
  }
}

function assertRsaPublicMembers(jwk: jose.JWK, label: string, index: number): void {
  if (typeof jwk.n !== 'string' || jwk.n.length === 0 || typeof jwk.e !== 'string' || !jwk.e)
    throw new Error(`${label}[${index}] must contain RSA modulus and exponent values`)
  if (jwk.e !== 'AQAB') throw new Error(`${label}[${index}] must use RSA exponent 65537`)
  let modulus: Uint8Array
  try {
    modulus = jose.base64url.decode(jwk.n)
  } catch (error) {
    throw new Error(`${label}[${index}] has an invalid RSA modulus`, { cause: error })
  }
  const firstByte = modulus[0]!
  const modulusBits = (modulus.byteLength - 1) * 8 + (32 - Math.clz32(firstByte))
  if (firstByte === 0 || modulusBits < MIN_RSA_MODULUS_BITS)
    throw new Error(`${label}[${index}] must use an RSA modulus of at least 2048 bits`)
}

function assertJwkRole(
  jwk: ManagedJwk,
  label: string,
  index: number,
  operation: 'sign' | 'verify',
): void {
  const privateMembers = PRIVATE_RSA_MEMBERS.filter((member) => jwk[member] !== undefined)
  if (operation === 'sign' && privateMembers.length !== PRIVATE_RSA_MEMBERS.length)
    throw new Error(`${label}[${index}] must contain complete RSA private key material`)
  if (operation === 'verify' && (privateMembers.length > 0 || jwk.oth !== undefined))
    throw new Error(`${label}[${index}] must not contain RSA private key material`)
  if (
    jwk.key_ops !== undefined &&
    (jwk.key_ops.length === 0 || jwk.key_ops.some((value) => value !== operation))
  )
    throw new Error(`${label}[${index}] key_ops must contain only ${operation}`)
}

async function importKeys(
  jwks: readonly ManagedJwk[],
  label: string,
): Promise<readonly ImportedJwtKey[]> {
  return Object.freeze(
    await Promise.all(
      jwks.map(async (jwk, index) => {
        try {
          const cryptoKey = (await jose.importJWK(jwk, JWT_ALGORITHM)) as jose.CryptoKey
          return Object.freeze({ cryptoKey, jwk })
        } catch (error) {
          throw new Error(`Failed to import ${label}[${index}]`, { cause: error })
        }
      }),
    ),
  )
}

function cloneAndFreezeJwk(jwk: jose.JWK): jose.JWK {
  const clone = {
    ...jwk,
    ...(jwk.key_ops === undefined ? {} : { key_ops: Object.freeze([...jwk.key_ops]) }),
    ...(jwk.x5c === undefined ? {} : { x5c: Object.freeze([...jwk.x5c]) }),
  } as jose.JWK
  return Object.freeze(clone)
}
