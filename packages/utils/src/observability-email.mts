const LOCAL_CHAR = /[A-Za-z0-9._%+-]/
const DOMAIN_CHAR = /[A-Za-z0-9.-]/
const LETTER = /[A-Za-z]/
const WORD_CHAR = /\w/

/** End of the longest `label.tld` domain in `text[from, end)`, or -1; one forward pass. */
function domainEnd(text: string, from: number, end: number): number {
  let best = -1
  let letterRunStart = from
  for (let index = from; index < end; index++) {
    if (!LETTER.test(text[index]!)) {
      letterRunStart = index + 1
      continue
    }
    const after = index + 1
    if (
      after - letterRunStart >= 2 &&
      letterRunStart - 1 > from &&
      text[letterRunStart - 1] === '.' &&
      !WORD_CHAR.test(text[after] ?? '')
    ) {
      best = after
    }
  }
  return best
}

/**
 * Replace email addresses with `replacement` in linear time. Matching starts from each `@` and
 * expands over local-part and domain characters, which never include `@`, so no character is
 * scanned more than a constant number of times (unlike a backtracking regular expression).
 */
export function redactEmails(text: string, replacement: string): string {
  let output = ''
  let copied = 0
  let at = text.indexOf('@')
  while (at !== -1) {
    let start = at
    while (start > copied && LOCAL_CHAR.test(text[start - 1]!)) start--
    let end = at + 1
    while (end < text.length && DOMAIN_CHAR.test(text[end]!)) end++
    const domain = domainEnd(text, at + 1, end)
    if (start < at && domain !== -1) {
      output += text.slice(copied, start) + replacement
      copied = domain
      at = text.indexOf('@', domain)
    } else {
      at = text.indexOf('@', at + 1)
    }
  }
  return output + text.slice(copied)
}
