import { describe, expect, it, vi } from 'vitest'

import { findSchemaViolation } from '../schema/index.mts'
import type { ToolApiEndpoint, ToolOutputSchema } from '../types.mts'
import { createManageEntityTool, ManageEntityInputError } from './manage-entity.mts'

type User = { id: string }
type Active = { id: string; email: string }

const entitySchema: ToolOutputSchema = {
  type: 'object',
  properties: { id: { type: 'string' }, name: { type: 'string' } },
  required: ['id', 'name'],
  additionalProperties: false,
}

function harness(overrides: Partial<Parameters<typeof createManageEntityTool>[0]> = {}) {
  const calls: string[] = []
  const requireUser = vi.fn((user: User): Promise<Active> => {
    calls.push('require')
    return Promise.resolve({ ...user, email: `${user.id}@example.test` })
  })
  const tool = createManageEntityTool<{ name: string }, { name: string }, User, Active>({
    toolName: 'manage_things',
    description: 'Manage things',
    addProperties: { name: { type: 'string' } },
    updateProperties: { name: { type: 'string' } },
    requireUser,
    addFn: (user, args) => {
      calls.push(`add:${user.email}:${args.name}`)
      return Promise.resolve({ id: 'new' })
    },
    updateFn: (user, args) => {
      calls.push(`update:${user.id}:${args.id}`)
      return Promise.resolve({ id: args.id })
    },
    removeFn: (_user, id) => {
      calls.push(`remove:${id}`)
      return Promise.resolve({ deleted: 'row' })
    },
    ...(overrides as object),
  })
  return { tool, calls, requireUser }
}

describe('createManageEntityTool', () => {
  it('declares the action tool without meta unless asked', () => {
    const { tool } = harness()

    expect(tool.meta).toBeUndefined()
    expect(tool.schema).toMatchObject({
      name: 'manage_things',
      description: 'Manage things',
      strict: null,
      parameters: {
        required: ['action'],
        properties: { action: { enum: ['add', 'update', 'remove'] }, name: { type: 'string' } },
      },
    })
  })

  it('resolves the caller first, then runs the matching mutation', async () => {
    const { tool, calls, requireUser } = harness()
    const call = tool.function({ id: 'u1' })

    expect(await call({ action: 'add', name: 'x' })).toEqual({
      success: true,
      result: { id: 'new' },
    })
    expect(await call({ action: 'update', id: 'e1', name: 'y' })).toEqual({
      success: true,
      result: { id: 'e1' },
    })
    expect(calls).toEqual(['require', 'add:u1@example.test:x', 'require', 'update:u1:e1'])
    expect(requireUser).toHaveBeenCalledWith({ id: 'u1' })
  })

  it('returns only the identity of a removed entity', async () => {
    const { tool, calls } = harness()

    expect(await tool.function({ id: 'u1' })({ action: 'remove', id: 'e9' })).toEqual({
      success: true,
      result: { id: 'e9' },
    })
    expect(calls).toEqual(['require', 'remove:e9'])
  })

  it('refuses a caller that requireUser rejects, before any mutation', async () => {
    const refusal = new Error('suspended')
    const { tool, calls } = harness({ requireUser: () => Promise.reject(refusal) } as never)

    await expect(tool.function({ id: 'u1' })({ action: 'add', name: 'x' })).rejects.toBe(refusal)
    expect(calls).toEqual([])
  })

  it('accepts a synchronous requireUser', async () => {
    const { tool, calls } = harness({
      requireUser: (user: User) => ({ ...user, email: 'sync' }),
    } as never)

    await tool.function({ id: 'u1' })({ action: 'add', name: 'x' })
    expect(calls).toEqual(['add:sync:x'])
  })

  it('requires an id for update and remove, with a 422 an error mapper can read', async () => {
    const { tool, calls } = harness()
    const call = tool.function({ id: 'u1' })

    for (const action of ['update', 'remove'] as const) {
      const failure = await Promise.resolve(call({ action } as never)).catch(
        (error: unknown) => error,
      )
      expect(failure).toBeInstanceOf(ManageEntityInputError)
      expect(failure).toMatchObject({
        status: 422,
        statusCode: 422,
        expose: true,
        name: 'ManageEntityInputError',
        message: `id is required for ${action}`,
      })
    }
    expect(calls).toEqual(['require', 'require'])
  })

  it('rejects unsupported actions without falling through to remove', async () => {
    const { tool, calls } = harness()

    await expect(
      tool.function({ id: 'u1' })({ action: 'destroy', id: 'e1' } as never),
    ).rejects.toMatchObject({ status: 422, message: 'Unsupported action: destroy' })
    expect(calls).toEqual(['require'])
  })

  describe('with meta', () => {
    const routes: ToolApiEndpoint[] = [
      { method: 'POST', path: '/things' },
      { method: 'PATCH', path: '/things/:id' },
      { method: 'DELETE', path: '/things/:id' },
    ]
    const manage = (api: ToolApiEndpoint[] | null) =>
      harness({ entitySchema, meta: { title: 'Things', api, scopes: ['things:write'] } }).tool

    it('names the route of the action the call performs', () => {
      const selectApi = manage(routes).meta!.selectApi!

      expect(selectApi({ action: 'add' })).toEqual([routes[0]])
      expect(selectApi({ action: 'update' })).toEqual([routes[1]])
      expect(selectApi({ action: 'remove' })).toEqual([routes[2]])
    })

    it.each([
      ['an action with no route listed', [routes[0]!]],
      ['no REST routes at all', null],
    ])('names no route for %s', (_label, api) => {
      expect(manage(api).meta!.selectApi!({ action: 'remove' })).toEqual([])
    })

    it('passes application meta through and derives the output schema', () => {
      const meta = manage(routes).meta!
      const output = meta.outputSchema!

      expect(meta).toMatchObject({ title: 'Things', scopes: ['things:write'] })
      expect(
        findSchemaViolation(output, { success: true, result: { id: 'a', name: 'n' } }),
      ).toBeNull()
      expect(findSchemaViolation(output, { success: true, result: { id: 'a' } })).toBeNull()
      expect(findSchemaViolation(output, { success: true, result: { name: 'n' } })).not.toBeNull()
      expect(findSchemaViolation(output, { success: false, result: { id: 'a' } })).not.toBeNull()
    })

    it('throws when meta is set without an entity schema', () => {
      expect(() => harness({ meta: { title: 'Things', api: null } })).toThrow(
        'manage_things must provide the entity schema its results return',
      )
    })
  })
})
