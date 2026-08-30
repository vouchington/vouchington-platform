import { describe, expect, it } from 'vitest'

import { parseOEmbedResponse } from './oembed.mts'

describe('oEmbed parsing', () => {
  it('extracts structured metadata and a single iframe URL', () => {
    const result = parseOEmbedResponse(
      Buffer.from(
        JSON.stringify({
          type: 'video',
          title: 'Example',
          author_name: 'Author',
          provider_name: 'Provider',
          thumbnail_url: '/thumbnail.jpg',
          thumbnail_width: '640',
          html: '<iframe src="https://player.example/video"></iframe>',
          width: 800,
          height: 450,
        }),
      ),
      'application/json; charset=utf-8',
      new URL('https://source.example/oembed'),
    )
    expect(result).toMatchObject({
      type: 'video',
      title: 'Example',
      authorName: 'Author',
      providerName: 'Provider',
      thumbnailWidth: 640,
      width: 800,
      height: 450,
    })
    expect(result.thumbnailUrl?.href).toBe('https://source.example/thumbnail.jpg')
    expect(result.playerUrl?.href).toBe('https://player.example/video')
    expect(result).not.toHaveProperty('html')
  })

  it('rejects non-JSON responses', () => {
    expect(() =>
      parseOEmbedResponse(Buffer.from('{}'), 'text/html', new URL('https://example.com')),
    ).toThrow('JSON')
  })

  it('rejects malformed UTF-8', () => {
    expect(() =>
      parseOEmbedResponse(
        Uint8Array.from([0xff]),
        'application/json',
        new URL('https://example.com'),
      ),
    ).toThrow()
  })

  it('rejects invalid JSON shapes and malformed content types', () => {
    expect(() =>
      parseOEmbedResponse(Buffer.from('[]'), 'application/json', new URL('https://example.com')),
    ).toThrow('JSON object')
    expect(() =>
      parseOEmbedResponse(Buffer.from('{}'), 'not a mime', new URL('https://example.com')),
    ).toThrow('invalid Content-Type')
    expect(() =>
      parseOEmbedResponse(
        Buffer.from('{}'),
        'application/activity+json',
        new URL('https://example.com'),
      ),
    ).not.toThrow()
  })

  it.each([
    '<iframe src="https://one.example"></iframe><iframe src="https://two.example"></iframe>',
    '<div>text</div><script src="https://player.example"></script>',
    '<iframe src="javascript:alert(1)"></iframe>',
  ])('does not accept unsafe or ambiguous player markup', (html) => {
    const result = parseOEmbedResponse(
      Buffer.from(JSON.stringify({ html })),
      'application/json',
      new URL('https://example.com/oembed'),
    )
    expect(result.playerUrl).toBeNull()
  })

  it('does not accept credential-bearing metadata URLs', () => {
    const result = parseOEmbedResponse(
      Buffer.from(
        JSON.stringify({
          author_url: 'https://user:secret@author.example/profile',
          thumbnail_url: 'https://user:secret@cdn.example/image',
          html: '<iframe src="https://user:secret@player.example/video"></iframe>',
        }),
      ),
      'application/json',
      new URL('https://example.com/oembed'),
    )
    expect(result.authorUrl).toBeNull()
    expect(result.thumbnailUrl).toBeNull()
    expect(result.playerUrl).toBeNull()
  })

  it('normalizes optional strings and dimensions', () => {
    const result = parseOEmbedResponse(
      Buffer.from(
        JSON.stringify({
          title: ' ',
          width: '640',
          height: 0,
          thumbnail_width: 1.5,
          thumbnail_height: '',
          html: '<iframe></iframe>',
        }),
      ),
      'application/json',
      new URL('https://example.com/oembed'),
    )
    expect(result.title).toBeNull()
    expect(result.width).toBe(640)
    expect(result.height).toBeNull()
    expect(result.thumbnailWidth).toBeNull()
    expect(result.thumbnailHeight).toBeNull()
    expect(result.playerUrl).toBeNull()
  })
})
