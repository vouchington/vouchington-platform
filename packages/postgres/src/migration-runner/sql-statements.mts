import { loadModule, parseSync } from '@libpg-query/parser'

let moduleLoad: Promise<void> | undefined

/**
 * Ensures the @libpg-query/parser WASM module is loaded.
 * Call this once at startup (or in test beforeAll) before using splitSqlStatements.
 */
export function loadSqlParserModule(): Promise<void> {
  return (moduleLoad ??= loadModule())
}

/**
 * Splits a SQL string into individual statements using the real PostgreSQL 18 parser.
 * Each returned string includes any leading comments from between the previous statement
 * and the start of this one.
 *
 * Requires loadSqlParserModule() to have resolved before the first call.
 *
 * The parser returns UTF-8 byte offsets. We operate on the SQL as a Buffer so that
 * positions remain accurate even when the source contains multi-byte characters
 * (e.g. → in comments). Each returned statement is decoded back to a UTF-8 string.
 *
 * Falls back to a semicolon-based splitter when parseSync rejects the input (e.g.
 * PL/pgSQL body fragments passed by the config-driven DDL guard test helpers). The
 * fallback handles dollar-quoted blocks and standard quoted strings so that semicolons
 * inside strings are not treated as statement terminators.
 */
export function splitSqlStatements(sql: string): string[] {
  if (!sql.trim()) return []
  let result
  try {
    result = parseSync(sql)
  } catch {
    return splitSqlBySemicolon(sql)
  }
  const stmts = result.stmts
  if (!stmts?.length) return []
  const sqlBytes = Buffer.from(sql, 'utf8')
  const out: string[] = []
  let prevEnd = 0
  for (const stmt of stmts) {
    const loc = stmt.stmt_location ?? 0
    const stmtEnd = stmt.stmt_len === undefined ? sqlBytes.length : loc + stmt.stmt_len
    out.push(sqlBytes.subarray(prevEnd, stmtEnd).toString('utf8').trim())
    prevEnd = skipSqlWhitespace(sqlBytes, stmtEnd)
    if (sqlBytes[prevEnd] === 0x3b) prevEnd++
    prevEnd = skipSqlWhitespace(sqlBytes, prevEnd)
  }
  return out
}

function skipSqlWhitespace(sqlBytes: Buffer, start: number): number {
  let index = start
  while (index < sqlBytes.length) {
    const byte = sqlBytes[index]
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) break
    index += 1
  }
  return index
}

type QuoteState = { kind: 'single' } | { kind: 'dollar'; tag: string } | null

/**
 * Fallback splitter for non-SQL content such as PL/pgSQL body fragments.
 * Splits on top-level semicolons while skipping single-quoted strings and
 * dollar-quoted blocks (but NOT line comments — those are already stripped
 * by the DDL guard helpers before this function is reached).
 */
function splitSqlBySemicolon(sql: string): string[] {
  const parts: string[] = []
  let start = 0
  let i = 0
  let quote: QuoteState = null

  while (i < sql.length) {
    if (quote === null) {
      if (sql[i] === "'") {
        quote = { kind: 'single' }
        i++
        continue
      }
      // Dollar-quoting: match $tag$ where tag is [A-Za-z0-9_]*
      // Only treat '$' as a dollar-quote delimiter if the preceding character is not
      // a word character — prevents abc$tag$ from being parsed as a dollar-quoted block.
      const previous = sql[i - 1] ?? ''
      if (i === 0 || !/[A-Za-z0-9_$]/u.test(previous)) {
        const tag = /^\$([A-Za-z0-9_]*)\$/u.exec(sql.slice(i))?.[0]
        if (tag) {
          quote = { kind: 'dollar', tag }
          i += tag.length
          continue
        }
      }
      if (sql[i] === ';') {
        const part = sql.slice(start, i).trim()
        if (part.length > 0) parts.push(part)
        start = i + 1
        i++
        continue
      }
      i++
    } else if (quote.kind === 'single') {
      if (sql[i] === "'" && sql[i + 1] === "'") {
        i += 2 // escaped quote inside single-quoted string
      } else if (sql[i] === "'") {
        quote = null
        i++
      } else {
        i++
      }
    } else {
      // Dollar-quoted block: scan for closing tag
      const closeIdx = sql.indexOf(quote.tag, i)
      if (closeIdx === -1) {
        i = sql.length // malformed; consume rest
      } else {
        i = closeIdx + quote.tag.length
        quote = null
      }
    }
  }

  const tail = sql.slice(start).trim()
  if (tail.length > 0) parts.push(tail)
  return parts
}
