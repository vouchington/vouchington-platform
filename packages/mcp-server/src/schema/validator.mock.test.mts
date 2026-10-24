import { describe, expect, it, vi } from 'vitest'

const format = vi.hoisted(() => ({ current: undefined as unknown }))

vi.mock('ajv-formats', () => ({
  default: Object.assign(() => undefined, { get: () => format.current }),
}))

const { findSchemaViolation } = await import('./validator.mts')

describe('findSchemaViolation without a synchronous full date-time format', () => {
  it.each([
    ['a string format', 'date-time'],
    ['a format without a validator', { async: false }],
    ['an asynchronous-looking format', { validate: 'not a function' }],
  ])('refuses %s', (_name, definition) => {
    format.current = definition

    expect(() => findSchemaViolation({ type: 'string' }, 'x')).toThrow(
      'date-time validation requires the synchronous Ajv full format',
    )
  })
})
