import { failedStatementOf } from './failed-statement.mts'
import { splitSqlStatements } from './sql-statements.mts'

const MAX_EXCERPT_LINES = 50

interface FailingStatement {
  /** UTF-16 index of the error cursor in the migration SQL. */
  cursor: number | undefined
  /** UTF-16 index of the statement in the migration SQL. */
  start: number
  text: string
}

/**
 * Renders the statement that raised `error`, numbered by migration file line and capped at
 * `maxLines` lines around the error position. Returns undefined when the statement is unknown.
 */
export function excerptFailingStatement(
  sql: string,
  error: object,
  maxLines = MAX_EXCERPT_LINES,
): string | undefined {
  const statement = locateFailingStatement(sql, error)
  return statement && renderStatement(sql, statement, maxLines)
}

function locateFailingStatement(sql: string, error: object): FailingStatement | undefined {
  const position = errorPosition(error)
  const online = failedStatementOf(error)
  if (online !== undefined) {
    // Online migrations send one statement at a time, so the position is relative to it.
    const start = sql.indexOf(online)
    const cursor = position === undefined ? undefined : start + codePointIndex(online, position)
    return { cursor, start, text: online }
  }

  // Transactional migrations send the whole file, so the position is relative to the file.
  const cursor = position === undefined ? undefined : codePointIndex(sql, position)
  let searchFrom = 0
  const statements = splitSqlStatements(sql).map((text) => {
    const start = sql.indexOf(text, searchFrom)
    searchFrom = start + text.length
    return { cursor, start, text }
  })
  if (statements.length === 1) return statements[0]
  if (cursor === undefined) return undefined
  return statements.find((statement) => cursor < statement.start + statement.text.length)
}

function renderStatement(sql: string, statement: FailingStatement, maxLines: number): string {
  const firstLine = lineNumberAt(sql, statement.start)
  const lines = statement.text.split('\n')
  const cursorLine =
    statement.cursor === undefined ? undefined : lineNumberAt(sql, statement.cursor) - firstLine
  const from =
    cursorLine === undefined
      ? 0
      : Math.max(0, Math.min(cursorLine - Math.floor(maxLines / 2), lines.length - maxLines))
  const to = Math.min(lines.length, from + maxLines)
  const width = String(firstLine + to - 1).length

  const output: string[] = []
  if (from > 0) output.push(`  … ${from} earlier lines of this statement`)
  for (let index = from; index < to; index += 1) {
    const marker = index === cursorLine ? '>' : ' '
    output.push(`${marker} ${String(firstLine + index).padStart(width)} | ${lines[index]}`)
  }
  if (to < lines.length) output.push(`  … ${lines.length - to} more lines of this statement`)
  return output.join('\n')
}

/** PostgreSQL reports a 1-based character position as a decimal string. */
function errorPosition(error: object): number | undefined {
  const { position } = error as { position?: unknown }
  const value = typeof position === 'string' ? Number(position) : Number.NaN
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/** Converts PostgreSQL's 1-based code-point position into a UTF-16 string index. */
function codePointIndex(text: string, position: number): number {
  let index = 0
  let codePoints = 1
  for (const character of text) {
    if (codePoints >= position) break
    index += character.length
    codePoints += 1
  }
  return index
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}
