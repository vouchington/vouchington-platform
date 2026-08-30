import type { Context } from '@jongleberry/api-server'
import { describe, expect, it, vi } from 'vitest'
import {
  createEmailOtpHandlers,
  createMfaHandlers,
  createOAuthHandlers,
  createPasskeyHandlers,
  type JsonAuthOperation,
} from './api-server.mts'

describe('API-server auth handlers', () => {
  it('parses bounded JSON and serializes operation results', async () => {
    const operation = {
      execute: vi.fn(async (body: unknown) => ({ body, ok: true })),
    }
    const handlers = createEmailOtpHandlers({ request: operation, continue: operation })
    const { context, json } = createContext({ email: 'person@example.test' })
    await handlers.request(context)
    expect(operation.execute).toHaveBeenCalledWith({ email: 'person@example.test' }, context)
    expect(json).toHaveBeenCalledWith({ body: { email: 'person@example.test' }, ok: true })
  })

  it('rejects non-JSON requests before executing operations', async () => {
    const operation = { execute: vi.fn(async () => undefined) }
    const handlers = createOAuthHandlers({ connect: operation, continue: operation })
    const { context } = createContext({}, false)
    await expect(handlers.continue(context)).rejects.toMatchObject({ status: 415 })
    expect(operation.execute).not.toHaveBeenCalled()
  })

  it('supports caller-owned redirect, cookie, or non-JSON responses', async () => {
    const respond = vi.fn()
    const operation = { execute: async () => ({ redirect: '/done' }), respond }
    const handlers = createOAuthHandlers({ connect: operation, continue: operation })
    const { context, json } = createContext({ code: 'authorization-code' })
    await handlers.continue(context)
    expect(respond).toHaveBeenCalledWith({ redirect: '/done' }, context)
    expect(json).not.toHaveBeenCalled()
  })

  it('maps complete passkey groups and optional MFA operations', async () => {
    const operation: JsonAuthOperation = { execute: async () => ({ ok: true }) }
    const passkeys = createPasskeyHandlers({
      registrationOptions: operation,
      registrationVerification: operation,
      authenticationOptions: operation,
      authenticationVerification: operation,
      discoverableOptions: operation,
      discoverableVerification: operation,
    })
    const status = { execute: vi.fn(async () => ({ enabled: true })) }
    const mfa = createMfaHandlers({
      status,
      totpVerification: operation,
      passkeyOptions: operation,
      passkeyVerification: operation,
      reauthentication: operation,
    })
    const minimalMfa = createMfaHandlers({ status })
    expect(Object.keys(passkeys)).toHaveLength(6)
    expect(mfa.status).toBeTypeOf('function')
    expect(minimalMfa.totpVerification).toBeUndefined()
    const { context } = createContext({})
    await passkeys.discoverableVerification(context)
    await mfa.status(context)
    await mfa.totpVerification?.(context)
    await mfa.passkeyOptions?.(context)
    await mfa.passkeyVerification?.(context)
    await mfa.reauthentication?.(context)
    expect(status.execute).toHaveBeenCalledWith(context)
  })
})

function createContext(body: unknown, isJson = true) {
  const json = vi.fn()
  const context = {
    request: {
      is: () => (isJson ? 'application/json' : false),
      json: vi.fn(async () => body),
    },
    assert(condition: unknown, status: number, message: string) {
      if (!condition) throw Object.assign(new Error(message), { status })
    },
    json,
  } as unknown as Context
  return { context, json }
}
