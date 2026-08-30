import { describe, expect, it, vi } from 'vitest'
import { createJwtSessionIssuer } from './jwt-session.mts'

const sessionJwt = vi.hoisted(() => ({ signJwt: vi.fn(async () => 'signed-token') }))

vi.mock('@vouchington/session-jwt', () => sessionJwt)

describe('JWT session issuer', () => {
  it('composes session-jwt with caller-owned subjects and claims', async () => {
    const keySet = { privateKeys: [], publicKeys: [] }
    const issue = createJwtSessionIssuer({
      keySet,
      issuer: 'https://example.test',
      audience: 'example-client',
      expiresIn: '1h',
      subject: (user: { id: string }) => user.id,
      claims: async () => ({ role: 'member' }),
    })
    await expect(issue({ id: 'user-1' }, undefined)).resolves.toBe('signed-token')
    expect(sessionJwt.signJwt).toHaveBeenCalledWith(
      { role: 'member', sub: 'user-1' },
      {
        keySet,
        issuer: 'https://example.test',
        audience: 'example-client',
        expiresIn: '1h',
      },
    )
  })

  it('forwards explicit issued-at values and rejects empty subjects', async () => {
    const issue = createJwtSessionIssuer({
      keySet: { privateKeys: [], publicKeys: [] },
      issuer: 'issuer',
      audience: ['client'],
      expiresIn: 60,
      issuedAt: 42,
      subject: (user: string) => user,
      claims: () => ({}),
    })
    await issue('user-1', undefined)
    expect(sessionJwt.signJwt).toHaveBeenLastCalledWith(
      { sub: 'user-1' },
      expect.objectContaining({ issuedAt: 42 }),
    )
    await expect(issue(' ', undefined)).rejects.toThrow('subject')
  })
})
