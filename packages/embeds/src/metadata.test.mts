import { describe, expect, it } from 'vitest'

import { extractDocumentMetadata, resolveHttpUrl } from './metadata.mts'

const base = new URL('https://example.com/path/page')

describe('document metadata', () => {
  it('uses ordered metadata fallbacks and resolves relative URLs', () => {
    expect(
      extractDocumentMetadata(
        {
          content: '',
          title: ' Page title ',
          meta: {
            'twitter:title': [' Twitter title '],
            'twitter:description': ' Twitter description ',
            'twitter:image': '../image.jpg',
          },
          links: { alternate: { 'application/json+oembed': ['/oembed'] } },
        },
        base,
      ),
    ).toEqual({
      title: 'Twitter title',
      description: 'Twitter description',
      thumbnailUrl: new URL('https://example.com/image.jpg'),
      oEmbedUrl: new URL('https://example.com/oembed'),
    })
  })

  it('falls back to the page title and handles absent metadata', () => {
    expect(
      extractDocumentMetadata({ content: '', title: ' Title ', meta: {}, links: {} }, base),
    ).toEqual({
      title: 'Title',
      description: null,
      thumbnailUrl: null,
      oEmbedUrl: null,
    })
    expect(
      extractDocumentMetadata({ content: '', title: ' ', meta: {}, links: { alternate: [] } }, base)
        .title,
    ).toBeNull()
  })

  it.each([
    ['', null],
    ['http://[', null],
    ['javascript:alert(1)', null],
    ['https://user:secret@example.com', null],
    ['http://example.com', 'http://example.com/'],
  ] as const)('normalizes metadata URL %j', (input, expected) => {
    expect(resolveHttpUrl(input, base)?.href ?? null).toBe(expected)
  })

  it('ignores malformed alternate-link maps and empty array values', () => {
    expect(
      extractDocumentMetadata(
        {
          content: '',
          meta: { description: ['', 1] },
          links: { alternate: { 'application/json+oembed': [] } },
        },
        base,
      ),
    ).toMatchObject({ description: null, oEmbedUrl: null })
  })
})
