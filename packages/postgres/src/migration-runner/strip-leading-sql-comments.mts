export function stripLeadingSqlComments(statement: string): string {
  let remaining = statement.trimStart()

  while (remaining.startsWith('--') || remaining.startsWith('/*')) {
    if (remaining.startsWith('--')) {
      const newline = remaining.indexOf('\n')
      if (newline === -1) return ''
      remaining = remaining.slice(newline + 1).trimStart()
      continue
    }

    const end = remaining.indexOf('*/')
    if (end === -1) return remaining
    remaining = remaining.slice(end + 2).trimStart()
  }

  return remaining
}
