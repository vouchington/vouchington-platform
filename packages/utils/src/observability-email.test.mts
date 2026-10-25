import { describe, expect, it } from 'vitest'
import { redactEmails } from './observability-email.mts'

const redact = (text: string) => redactEmails(text, '[E]')

describe('redactEmails', () => {
  it.each([
    ['write Person.Name+tag@Example.test now', 'write [E] now'],
    ['a@b.co', '[E]'],
    ['<x@mail.example.org>, y_z%1@sub-d.io.', '<[E]>, [E].'],
    ['first a@b.co then c@d.io', 'first [E] then [E]'],
    ['user@host.example.com-suffix', '[E]-suffix'],
  ])('redacts %j', (input, expected) => {
    expect(redact(input)).toBe(expected)
  })

  it.each([
    'nothing here',
    '@example.com',
    'user@',
    'user@localhost',
    'user@host.c',
    'user@.com',
    'user@host.co1',
    'user@host.co_x',
    'a@@b.co',
  ])('leaves %j unchanged', (input) => {
    expect(redact(input)).toBe(input)
  })

  it('keeps scanning after a failed candidate', () => {
    expect(redact('a@b and c@d.io')).toBe('a@b and [E]')
  })

  it('runs in linear time on adversarial input', () => {
    const inputs = ['a.'.repeat(200_000), `${'a'.repeat(100_000)}@${'b'.repeat(100_000)}`]
    for (const input of inputs) {
      const started = performance.now()
      expect(redact(input)).toBe(input)
      expect(performance.now() - started).toBeLessThan(500)
    }
    const manyAts = 'a@'.repeat(100_000)
    const started = performance.now()
    expect(redact(manyAts)).toBe(manyAts)
    expect(performance.now() - started).toBeLessThan(500)
  })
})
