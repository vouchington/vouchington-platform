import { describe, expect, it } from 'vitest'
import { stripCodeCommentsAndStrings } from './index.mts'

describe('stripCodeCommentsAndStrings', () => {
  it('masks line comments, nested block comments, and quoted literals while preserving lines', () => {
    const source = `let visible = key // trailing comment
/* outer
  /* inner */
*/
let text = "hidden \\"value\\"\\\nstill-hidden\nnext"
let ch = 'x'
// eof comment`
    const masked = stripCodeCommentsAndStrings(source)

    expect(masked).toHaveLength(source.length)
    expect(masked.split('\n')).toHaveLength(source.split('\n').length)
    expect(masked).toContain('let visible = key')
    expect(masked).not.toContain('trailing')
    expect(masked).not.toContain('outer')
    expect(masked).not.toContain('inner')
    expect(masked).not.toContain('hidden')
    expect(masked).not.toContain('eof')
  })

  it('preserves C# interpolation expressions while masking literal text and escapes', () => {
    const source =
      'var value = $"hidden {{literal}} \\"q\\" {localize(UiMessageKey.CommonCancel, new { nested = 1 })}\nline2";'
    const masked = stripCodeCommentsAndStrings(source, true)

    expect(masked).toHaveLength(source.length)
    expect(masked.split('\n')).toHaveLength(source.split('\n').length)
    expect(masked).toContain('localize(UiMessageKey.CommonCancel, new { nested = 1 })')
    expect(masked).not.toContain('hidden')
    expect(masked).not.toContain('literal')
    expect(masked).not.toContain('line2')
  })

  it('treats $" as ordinary code plus string when C# interpolation mode is disabled', () => {
    const source = 'let x = $"{UiMessageKey.Hidden}"'
    const masked = stripCodeCommentsAndStrings(source, false)

    expect(masked).toHaveLength(source.length)
    expect(masked).toContain('let x = $')
    expect(masked).not.toContain('Hidden')
  })
})
