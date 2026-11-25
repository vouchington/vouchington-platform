type MaskedSegment = Readonly<{
  text: string
  endIndex: number
}>

/**
 * Replaces line comments, nested block comments, and quoted string literals with spaces while
 * preserving exact length and newline positions. When `preserveCsharpInterpolation` is `true`,
 * C# `$"...{expr}..."` literal text is masked while expressions inside `{...}` stay visible.
 */
export function stripCodeCommentsAndStrings(
  source: string,
  preserveCsharpInterpolation = false,
): string {
  let result = ''
  let index = 0
  while (index < source.length) {
    const character = source[index]!
    const next = source[index + 1]
    if (character === '/' && next === '/') {
      const segment = maskLineComment(source, index)
      result += segment.text
      index = segment.endIndex
    } else if (character === '/' && next === '*') {
      const segment = maskBlockComment(source, index)
      result += segment.text
      index = segment.endIndex
    } else if (preserveCsharpInterpolation && character === '$' && next === '"') {
      const segment = maskCsharpInterpolatedString(source, index)
      result += segment.text
      index = segment.endIndex
    } else if (character === '"' || character === "'") {
      const segment = maskQuotedLiteral(source, index, character)
      result += segment.text
      index = segment.endIndex
    } else {
      result += character
      index += 1
    }
  }
  return result
}

function maskLineComment(source: string, startIndex: number): MaskedSegment {
  let text = '  '
  let index = startIndex + 2
  while (index < source.length && source[index] !== '\n') {
    text += ' '
    index += 1
  }
  if (source[index] === '\n') {
    text += '\n'
    index += 1
  }
  return { text, endIndex: index }
}

function maskBlockComment(source: string, startIndex: number): MaskedSegment {
  let text = '  '
  let index = startIndex + 2
  let depth = 1
  while (index < source.length && depth > 0) {
    const character = source[index]!
    const next = source[index + 1]
    if (character === '/' && next === '*') {
      depth += 1
      text += '  '
      index += 2
    } else if (character === '*' && next === '/') {
      depth -= 1
      text += '  '
      index += 2
    } else {
      text += character === '\n' ? '\n' : ' '
      index += 1
    }
  }
  return { text, endIndex: index }
}

function maskQuotedLiteral(
  source: string,
  startIndex: number,
  delimiter: '"' | "'",
): MaskedSegment {
  let text = ' '
  let index = startIndex + 1
  while (index < source.length) {
    const character = source[index]!
    const next = source[index + 1]
    if (character === '\\') {
      text += next === '\n' ? ' \n' : '  '
      index += 2
    } else if (character === delimiter) {
      text += ' '
      index += 1
      break
    } else {
      text += character === '\n' ? '\n' : ' '
      index += 1
    }
  }
  return { text, endIndex: index }
}

function maskCsharpInterpolatedString(source: string, startIndex: number): MaskedSegment {
  let text = '  '
  let index = startIndex + 2
  let interpolationDepth = 0
  while (index < source.length) {
    const character = source[index]!
    const next = source[index + 1]
    if (interpolationDepth === 0) {
      if (character === '"') {
        text += ' '
        index += 1
        break
      }
      if (character === '{' && next === '{') {
        text += '  '
        index += 2
      } else if (character === '{') {
        interpolationDepth = 1
        text += ' '
        index += 1
      } else if (character === '\\') {
        text += '  '
        index += 2
      } else {
        text += character === '\n' ? '\n' : ' '
        index += 1
      }
    } else {
      if (character === '{') interpolationDepth += 1
      if (character === '}') interpolationDepth -= 1
      text += interpolationDepth === 0 ? ' ' : character
      index += 1
    }
  }
  return { text, endIndex: index }
}
