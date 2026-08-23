import { createHash } from 'node:crypto'

const PREPARED_STATEMENT_HASH_LENGTH = 32
const MAX_PREPARED_STATEMENT_NAME_LENGTH = 63
const PREPARED_STATEMENT_PREFIX = 's_'
export const LEADING_QUERY_ANNOTATION_PATTERN = /^\s*\/\*\s*([\s\S]*?)\s*\*\//

export function extractLeadingQueryAnnotation(sqlText: string): string | null {
  const match = sqlText.match(LEADING_QUERY_ANNOTATION_PATTERN)
  const annotation = match?.[1]?.trim()
  return annotation ? annotation : null
}

export function assertLeadingQueryAnnotation(
  sqlText: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV === 'test' || env.VITEST === 'true') return
  if (extractLeadingQueryAnnotation(sqlText)) return
  throw new Error('PostgreSQL query must start with an annotation comment')
}

export function buildPreparedStatementName(sqlText: string, explicitName?: string): string {
  if (explicitName) return explicitName

  const hash = createHash('sha256')
    .update(sqlText)
    .digest('hex')
    .slice(0, PREPARED_STATEMENT_HASH_LENGTH)

  const annotation = extractLeadingQueryAnnotation(sqlText)
  if (!annotation) return `${PREPARED_STATEMENT_PREFIX}${hash}`

  const maxAnnotationLength =
    MAX_PREPARED_STATEMENT_NAME_LENGTH -
    PREPARED_STATEMENT_PREFIX.length -
    PREPARED_STATEMENT_HASH_LENGTH -
    1

  const sanitizedAnnotation = annotation
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxAnnotationLength)

  if (!sanitizedAnnotation) return `${PREPARED_STATEMENT_PREFIX}${hash}`
  return `${PREPARED_STATEMENT_PREFIX}${sanitizedAnnotation}_${hash}`
}
