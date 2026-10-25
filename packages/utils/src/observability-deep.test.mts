import { describe, expect, it } from 'vitest'
import {
  CIRCULAR_VALUE,
  EMAIL_REDACTED,
  MIN_MAX_DEPTH,
  SENSITIVE_VALUE,
  TOKEN_REDACTED,
  composeBeforeSend,
  redactText,
  scrubBreadcrumb,
  scrubDeep,
  scrubEvent,
} from './observability.mts'

const options = { credentialHeaders: ['authorization'] }

describe('redactText', () => {
  it('redacts bearer and basic credentials, token assignments, and emails', () => {
    expect(redactText('a Bearer abc.def== b Basic dXNlcg==')).toBe(
      'a Bearer [Filtered token] b Basic [Filtered token]',
    )
    expect(redactText('?token=abc&x=1 password=hunter2')).toBe(
      '?token=[Filtered token]&x=1 password=[Filtered token]',
    )
    expect(redactText('write Person.Name+tag@Example.test now')).toBe('write [Filtered email] now')
    expect(redactText('nothing here')).toBe('nothing here')
  })
})

describe('scrubDeep', () => {
  it('redacts sensitive keys and free text at any depth', () => {
    const result = scrubDeep({
      user: { email: 'a@b.test', id: 1 },
      extra: { nested: { token: 'abc', list: [{ api_key: 'k' }, 'mail a@b.test', 3] } },
    })
    expect(result).toEqual({
      user: { email: SENSITIVE_VALUE, id: 1 },
      extra: {
        nested: {
          token: SENSITIVE_VALUE,
          list: [{ api_key: SENSITIVE_VALUE }, 'mail [Filtered email]', 3],
        },
      },
    })
  })

  it('returns unchanged input by identity', () => {
    const value = { a: [1, 'x', { b: null }], c: undefined }
    expect(scrubDeep(value)).toBe(value)
    expect(scrubDeep(null)).toBeNull()
    expect(scrubDeep(5)).toBe(5)
  })

  it('leaves Date, Error, and class instances untouched', () => {
    class Box {
      email = 'a@b.test'
    }
    const date = new Date(0)
    const error = new Error('a@b.test')
    const box = new Box()
    const value = {
      date,
      error,
      box,
      nullProto: Object.assign(Object.create(null), { token: 't' }),
    }
    const result = scrubDeep(value)
    expect(result.date).toBe(date)
    expect(result.error).toBe(error)
    expect(result.box).toBe(box)
    expect(result.nullProto).toEqual({ token: SENSITIVE_VALUE })
  })

  it('replaces cycles but not shared references', () => {
    const shared = { note: 'a@b.test' }
    const loop: Record<string, unknown> = { name: 'x', shared }
    loop.self = loop
    const list: unknown[] = [shared]
    list.push(list)
    const result = scrubDeep({ loop, list, again: shared }) as Record<string, any>
    expect(result.loop.self).toBe(CIRCULAR_VALUE)
    expect(result.loop.shared).toEqual({ note: '[Filtered email]' })
    expect(result.list[1]).toBe(CIRCULAR_VALUE)
    expect(result.again).toEqual({ note: '[Filtered email]' })
  })

  it('fails closed beyond the depth bound', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { token: 'x' } } } } } } } } }
    expect(scrubDeep(deep, { maxDepth: 8 })).toEqual({
      a: { b: { c: { d: { e: { f: { g: { h: SENSITIVE_VALUE } } } } } } },
    })
    expect(scrubDeep(deep, { maxDepth: 9 })).toEqual({
      a: { b: { c: { d: { e: { f: { g: { h: { token: SENSITIVE_VALUE } } } } } } } },
    })
    let nested: Record<string, unknown> = { leaf: 'a@b.test' }
    for (let i = 0; i < 40; i += 1) nested = { next: nested }
    expect(JSON.stringify(scrubDeep(nested))).not.toContain('a@b.test')
    expect(JSON.stringify(scrubDeep(nested))).toContain(SENSITIVE_VALUE)
  })

  it.each([0, 7, 8.5, Number.NaN])('rejects maxDepth %s below the structural floor', (maxDepth) => {
    expect(() => scrubDeep({}, { maxDepth })).toThrow(RangeError)
  })

  it('keeps event structure at the minimum depth', () => {
    const event = {
      fingerprint: ['stable-group'],
      exception: { values: [{ stacktrace: { frames: [{ vars: { note: 'ok' } }] } }] },
    }
    expect(scrubDeep(event, { maxDepth: MIN_MAX_DEPTH })).toBe(event)
  })

  it('is stable across repeated passes', () => {
    const once = redactText('?token=abc&x=1 Bearer abc a@b.test')
    expect(redactText(once)).toBe(once)
    expect(once).toBe(`?token=${TOKEN_REDACTED}&x=1 Bearer ${TOKEN_REDACTED} ${EMAIL_REDACTED}`)
  })

  it('scrubs shared subtrees once instead of once per path', () => {
    let node: Record<string, unknown> = { note: 'clean' }
    for (let level = 0; level < 9; level += 1) {
      const previous = node
      node = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`k${index}`, previous]))
    }
    const started = performance.now()
    expect(scrubDeep(node)).toBe(node)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('rescrubs a shared subtree first reached deeper when later reached shallower', () => {
    const shared = { a: { b: 'x' } }
    let deepPath: Record<string, unknown> = { shared }
    for (let level = 0; level < 9; level += 1) deepPath = { next: deepPath }
    const result = scrubDeep({ deepPath, shared }) as Record<string, unknown>
    expect(result.shared).toBe(shared)
  })

  it('accepts injected key patterns and text redactors, including global regexes', () => {
    const result = scrubDeep(
      { ssn: '1', other: '2', ssn2: '3', note: 'id 123-45-6789' },
      {
        sensitiveKeyPatterns: [/^ssn/g],
        textRedactors: [(text) => text.replace(/\d{3}-\d{2}-\d{4}/g, '[ssn]')],
      },
    )
    expect(result).toEqual({
      ssn: SENSITIVE_VALUE,
      other: '2',
      ssn2: SENSITIVE_VALUE,
      note: 'id [ssn]',
    })
  })

  it('keeps __proto__ as an own data key', () => {
    const value = JSON.parse('{"__proto__":{"token":"x"}}')
    const result = scrubDeep(value)
    expect(Object.keys(result)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })
})

describe('scrubEvent recursion', () => {
  const leaky = () => ({
    message: 'by a@b.test',
    user: { email: 'a@b.test' },
    extra: { nested: { token: 'abc' } },
    breadcrumbs: [{ message: 'a@b.test Bearer abc123', data: { url: '/a?q=1' } }],
    request: { headers: { authorization: 'x' } },
  })

  it('scrubs user, extra, free text, and breadcrumb messages', () => {
    const result = scrubEvent(leaky(), options)
    expect(result).toEqual({
      message: 'by [Filtered email]',
      user: { email: SENSITIVE_VALUE },
      extra: { nested: { token: SENSITIVE_VALUE } },
      breadcrumbs: [{ message: '[Filtered email] Bearer [Filtered token]', data: { url: '/a' } }],
      request: { headers: { authorization: SENSITIVE_VALUE } },
    })
  })

  it('scrubs a single breadcrumb', () => {
    const crumb: { message: string; data?: Record<string, unknown> } = {
      message: 'a@b.test',
      data: { token: 't' },
    }
    expect(scrubBreadcrumb(crumb, options)).toEqual({
      message: '[Filtered email]',
      data: { token: SENSITIVE_VALUE },
    })
    const plain: { message: string; data?: Record<string, unknown> } = { message: 'plain' }
    expect(scrubBreadcrumb(plain, options)).toBe(plain)
  })

  it('runs the injected beforeSend before the final scrub', () => {
    const send = composeBeforeSend<Record<string, unknown>, undefined>(
      (event) => ({ ...event, extra: { token: 'late' } }),
      options,
    )
    expect(send({ message: 'm' }, undefined)).toEqual({
      message: 'm',
      extra: { token: SENSITIVE_VALUE },
    })
  })
})
