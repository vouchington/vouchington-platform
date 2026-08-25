import { describe, expect, it } from 'vitest'
import { imageFormatContentType, negotiateImageFormat } from './formats.mts'

describe('image format negotiation', () => {
  it('honors explicit formats and q-values', () => {
    expect(negotiateImageFormat({ requested: 'jpeg' })).toBe('jpeg')
    expect(negotiateImageFormat({ accept: 'image/png;q=0.4,image/webp;q=0.9' })).toBe('webp')
    expect(negotiateImageFormat({ accept: 'image/*' })).toBe('avif')
  })

  it('uses caller-selected format sets and fallback', () => {
    expect(negotiateImageFormat({ supported: ['png'], fallback: 'png' })).toBe('png')
    expect(negotiateImageFormat({ accept: 'text/html', fallback: 'jpeg' })).toBe('jpeg')
    expect(negotiateImageFormat({ accept: '   ' })).toBe('avif')
    expect(imageFormatContentType('avif')).toBe('image/avif')
  })

  it('rejects invalid caller choices', () => {
    expect(() => negotiateImageFormat({ supported: [] })).toThrow('fallback')
    expect(() => negotiateImageFormat({ supported: ['png'], requested: 'webp' })).toThrow(
      'requested',
    )
    expect(() => negotiateImageFormat({ supported: ['png'], fallback: 'jpeg' })).toThrow('fallback')
  })
})
