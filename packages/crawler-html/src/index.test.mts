import { describe, expect, it } from 'vitest'
import { extractHtmlContent, isHtmlContentType } from './index.mts'

describe('crawler html', () => {
  it('recognizes HTML content types', () => {
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true)
    expect(isHtmlContentType('APPLICATION/XHTML+XML')).toBe(true)
    expect(isHtmlContentType('application/json')).toBe(false)
    expect(isHtmlContentType(null)).toBe(false)
  })

  it('decodes and extracts HTML content', async () => {
    const content = await extractHtmlContent(
      Buffer.from('<html><head><title>Example</title></head><body><p>Hello</p></body></html>'),
      'text/html; charset=utf-8',
      {},
    )
    expect(content.title).toBe('Example')
    expect(content.content).toContain('Hello')
  })

  it('rejects a non-HTML content type before decoding', async () => {
    await expect(extractHtmlContent(Buffer.from('{}'), 'application/json', {})).rejects.toThrow(
      'HTML content',
    )
  })
})
