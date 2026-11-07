import { describe, expect, it } from 'vitest'

import { canonicalizeUrl, isBareDomainUrl } from './urls.mts'

const identity = (input: string): string | undefined => canonicalizeUrl(input)?.identity

describe('canonicalizeUrl', () => {
  it.each(['not a url', '', 'ftp://example.com/a', 'mailto:a@example.com', 'http://./'])(
    'returns null for %j',
    (input) => {
      expect(canonicalizeUrl(input)).toBeNull()
    },
  )

  it('removes host, port, credential, fragment, and trailing slash noise', () => {
    expect(canonicalizeUrl('https://user:pw@EXAMPLE.com.:443/A/b/?x=1#frag')).toEqual({
      url: 'https://example.com/A/b?x=1',
      identity: 'example.com/A/b?x=1',
    })
    expect(canonicalizeUrl('http://example.com:80/a//')?.url).toBe('http://example.com/a')
  })

  it('keeps non-default ports in both results', () => {
    expect(canonicalizeUrl('http://example.com:8080/a')).toEqual({
      url: 'http://example.com:8080/a',
      identity: 'example.com:8080/a',
    })
  })

  it('accepts a URL without mutating it', () => {
    const input = new URL('https://example.com/a/#frag')
    expect(canonicalizeUrl(input)?.url).toBe('https://example.com/a')
    expect(input.href).toBe('https://example.com/a/#frag')
  })

  it('maps schemes, www, and m to one identity while url keeps them', () => {
    const inputs = [
      'http://example.com/a',
      'https://example.com/a',
      'https://www.example.com/a',
      'https://m.example.com/a',
    ]
    expect(new Set(inputs.map(identity))).toEqual(new Set(['example.com/a']))
    expect(canonicalizeUrl('http://www.example.com/a')?.url).toBe('http://www.example.com/a')
  })

  it('keeps a host label when removing it would leave a top-level domain', () => {
    expect(identity('https://m.co/a')).toBe('m.co/a')
    expect(identity('https://www.localhost/a')).toBe('www.localhost/a')
  })

  it('gives root URLs a pathless identity and keeps the root slash in url', () => {
    expect(canonicalizeUrl('https://example.com')).toEqual({
      url: 'https://example.com/',
      identity: 'example.com',
    })
    expect(identity('https://example.com/?a=1')).toBe('example.com/?a=1')
  })

  it('drops tracking params case-insensitively and sorts the rest', () => {
    expect(
      canonicalizeUrl(
        'https://example.com/a?z=1&UTM_Source=x&utm_medium=y&gclid=1&fbclid=2&mc_cid=3&mc_eid=4&ref_src=5&a=2',
      ),
    ).toEqual({ url: 'https://example.com/a?a=2&z=1', identity: 'example.com/a?a=2&z=1' })
    expect(canonicalizeUrl('https://example.com/a?utm_source=x')?.url).toBe('https://example.com/a')
  })

  it.each(['si', '_hsenc', '_hsmi', 'trk', 'vero_id', 'oly_enc_id'])(
    'drops the %s tracking param case-insensitively',
    (name) => {
      expect(
        canonicalizeUrl(`https://example.com/a?b=1&${name}=x&${name.toUpperCase()}=y`),
      ).toEqual({ url: 'https://example.com/a?b=1', identity: 'example.com/a?b=1' })
    },
  )

  it('keeps ref, which some sites use to change page content', () => {
    expect(canonicalizeUrl('https://example.com/a?ref=home&si=x')?.url).toBe(
      'https://example.com/a?ref=home',
    )
  })

  it('keeps non-tracking params that only resemble tracking ones', () => {
    expect(identity('https://example.com/?ref=home&utmost=1')).toBe(
      'example.com/?ref=home&utmost=1',
    )
  })

  it.each([
    'https://youtu.be/abc_-123',
    'https://youtu.be/abc_-123/?t=10',
    'https://youtube.com/watch?v=abc_-123',
    'https://www.youtube.com/watch?t=10&v=abc_-123&list=PL1',
    'https://m.youtube.com/watch?v=abc_-123',
    'https://youtube.com/shorts/abc_-123',
    'https://www.youtube.com/embed/abc_-123?start=3',
  ])('maps %s to the video identity', (input) => {
    expect(identity(input)).toBe('youtube.com/watch?v=abc_-123')
  })

  it('keeps the original YouTube link, including its video params, in url', () => {
    expect(canonicalizeUrl('https://youtu.be/abc?t=10&utm_source=x')?.url).toBe(
      'https://youtu.be/abc?t=10',
    )
  })

  it.each([
    ['https://youtube.com/watch', 'youtube.com/watch'],
    ['https://youtube.com/@channel', 'youtube.com/@channel'],
    ['https://youtube.com/watch?v=a%20b', 'youtube.com/watch?v=a+b'],
    ['https://youtube.com/embed/videoseries?list=PL1', 'youtube.com/embed/videoseries?list=PL1'],
    ['https://youtube.com/embed/live_stream?channel=C', 'youtube.com/embed/live_stream?channel=C'],
    ['https://youtu.be/', 'youtu.be'],
    ['https://youtube.com:8443/watch?v=abc', 'youtube.com:8443/watch?v=abc'],
    ['https://notyoutube.com/watch?v=abc', 'notyoutube.com/watch?v=abc'],
  ])('does not treat %s as a video', (input, expected) => {
    expect(identity(input)).toBe(expected)
  })
})

describe('isBareDomainUrl', () => {
  it.each([
    'https://youtube.com/',
    'https://www.example.com',
    'https://example.com/?utm_source=x#top',
    'https://example.com//',
    new URL('http://example.com:8080/'),
  ])('is true for %s', (input) => {
    expect(isBareDomainUrl(input)).toBe(true)
  })

  it.each([
    'https://example.com/a',
    'https://example.com/?q=1',
    'https://youtu.be/abc',
    'ftp://example.com/',
    'not a url',
  ])('is false for %s', (input) => {
    expect(isBareDomainUrl(input)).toBe(false)
  })
})
