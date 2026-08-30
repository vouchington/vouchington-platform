import { describe, expect, it, vi } from 'vitest'

import { MediaError } from './errors.mts'
import { validateMediaUpload } from './validation.mts'

const policy = { acceptsContentType: (type: string) => type === 'image/png', maxBytes: 10 }

describe('validateMediaUpload', () => {
  it('normalizes a valid content type and accepts size boundaries', () => {
    expect(
      validateMediaUpload({ contentType: ' IMAGE/PNG; charset=x ', contentLength: 1 }, policy),
    ).toEqual({ contentType: 'image/png', contentLength: 1 })
    expect(validateMediaUpload({ contentType: 'image/png', contentLength: 10 }, policy)).toEqual({
      contentType: 'image/png',
      contentLength: 10,
    })
    expect(
      validateMediaUpload(
        { contentType: 'image/png', contentLength: 0 },
        { ...policy, minBytes: 0 },
      ),
    ).toEqual({ contentType: 'image/png', contentLength: 0 })
  })

  it.each([undefined, null, '', 'invalid', 'text/plain'])('rejects content type %s', (value) => {
    expect(() =>
      validateMediaUpload({ contentType: value, contentLength: 1 }, policy),
    ).toThrowError(expect.objectContaining<Partial<MediaError>>({ code: 'CONTENT_TYPE_INVALID' }))
  })

  it.each([undefined, null, 0, -1, 1.5, 11, Number.MAX_SAFE_INTEGER + 1])(
    'rejects content length %s',
    (value) => {
      expect(() =>
        validateMediaUpload({ contentType: 'image/png', contentLength: value }, policy),
      ).toThrowError(
        expect.objectContaining<Partial<MediaError>>({ code: 'CONTENT_LENGTH_INVALID' }),
      )
    },
  )

  it('creates coded errors with causes', () => {
    const cause = new Error('cause')
    expect(new MediaError('INVALID_STATE', 'message', { cause })).toMatchObject({
      name: 'MediaError',
      code: 'INVALID_STATE',
      cause,
    })
    expect(vi.isMockFunction(policy.acceptsContentType)).toBe(false)
  })
})
