import { describe, expect, it } from 'vitest'

import {
  buildWebPushPayload,
  decodeBase64Url,
  decodeVapidPublicKey,
  encodeBase64Url,
  getPushServiceAudience,
  isWebPushSubscription,
  parseWebPushPayload,
  parseWebPushSubscription,
} from './web-push.mts'

const p256dh = encodeBase64Url(new Uint8Array([0x04, ...new Uint8Array(64).fill(7)]))
const auth = encodeBase64Url(new Uint8Array(16).fill(1))
const subscription = {
  endpoint: 'https://push.example.com/send/abc',
  expirationTime: null,
  keys: { p256dh, auth },
}

describe('base64url', () => {
  it('round-trips bytes, with and without padding', () => {
    const bytes = new Uint8Array([251, 255, 254, 1])
    const encoded = encodeBase64Url(bytes)
    expect(encoded).toBe('-__-AQ')
    expect([...decodeBase64Url(encoded)]).toEqual([...bytes])
    expect([...decodeBase64Url('-__-AQ==')]).toEqual([...bytes])
  })

  it('rejects invalid input', () => {
    expect(() => decodeBase64Url('a$b')).toThrow(TypeError)
    expect(() => decodeBase64Url('a')).toThrow(TypeError)
  })
})

describe('VAPID public keys and audiences', () => {
  it('accepts an uncompressed P-256 point only', () => {
    expect(decodeVapidPublicKey(p256dh)).toHaveLength(65)
    expect(() => decodeVapidPublicKey(auth)).toThrow(TypeError)
    const compressed = encodeBase64Url(new Uint8Array([0x02, ...new Uint8Array(64)]))
    expect(() => decodeVapidPublicKey(compressed)).toThrow(TypeError)
  })

  it('derives the push service audience', () => {
    expect(getPushServiceAudience('https://push.example.com:8443/a/b?c=1')).toBe(
      'https://push.example.com:8443',
    )
  })
})

describe('parseWebPushSubscription', () => {
  it('normalizes a valid subscription', () => {
    expect(parseWebPushSubscription(subscription)).toEqual(subscription)
    expect(parseWebPushSubscription({ ...subscription, expirationTime: 5 }).expirationTime).toBe(5)
    const { expirationTime: _omit, ...withoutExpiry } = subscription
    expect(parseWebPushSubscription(withoutExpiry).expirationTime).toBeNull()
    expect(isWebPushSubscription(subscription)).toBe(true)
  })

  it.each([
    ['non-object', 'x'],
    ['null', null],
    ['missing endpoint', { ...subscription, endpoint: undefined }],
    ['long endpoint', { ...subscription, endpoint: `https://a.example/${'x'.repeat(3000)}` }],
    ['http endpoint', { ...subscription, endpoint: 'http://push.example.com/x' }],
    ['unparseable endpoint', { ...subscription, endpoint: 'not a url' }],
    ['bad expiry type', { ...subscription, expirationTime: 'soon' }],
    ['negative expiry', { ...subscription, expirationTime: -1 }],
    ['missing keys', { ...subscription, keys: undefined }],
    ['null keys', { ...subscription, keys: null }],
    ['non-string key', { ...subscription, keys: { p256dh: 1, auth } }],
    ['short auth', { ...subscription, keys: { p256dh, auth: p256dh } }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseWebPushSubscription(value)).toThrow(TypeError)
    expect(isWebPushSubscription(value)).toBe(false)
  })

  it('applies an injected endpoint policy and length limit', () => {
    const allowEndpoint = (url: URL) => url.hostname.endsWith('.example.com')
    expect(isWebPushSubscription(subscription, { allowEndpoint })).toBe(true)
    expect(
      isWebPushSubscription(
        { ...subscription, endpoint: 'https://evil.test/x' },
        { allowEndpoint },
      ),
    ).toBe(false)
    expect(isWebPushSubscription(subscription, { maxEndpointLength: 10 })).toBe(false)
  })
})

describe('payloads', () => {
  it('builds and parses a payload round trip', () => {
    const bytes = buildWebPushPayload({
      title: 'Hi',
      body: 'b',
      url: '/u',
      icon: '/i.png',
      tag: 't',
      data: { id: 1 },
    })
    expect(parseWebPushPayload(new TextDecoder().decode(bytes))).toEqual({
      title: 'Hi',
      body: 'b',
      url: '/u',
      icon: '/i.png',
      tag: 't',
      data: { id: 1 },
    })
  })

  it('rejects missing titles and oversize payloads', () => {
    expect(() => buildWebPushPayload({ title: '' })).toThrow(TypeError)
    expect(() => buildWebPushPayload({ title: 'x'.repeat(50) }, 20)).toThrow(RangeError)
  })

  it('returns null or drops invalid fields when parsing', () => {
    expect(parseWebPushPayload('{')).toBeNull()
    expect(parseWebPushPayload('1')).toBeNull()
    expect(parseWebPushPayload('null')).toBeNull()
    expect(parseWebPushPayload('{"body":"x"}')).toBeNull()
    expect(parseWebPushPayload('{"title":"t","body":1,"data":[1]}')).toEqual({ title: 't' })
  })
})
