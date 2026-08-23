import type { QueryOptions } from './types.mts'
import type { SQLStatement } from 'sql-template-strings'

export type CursorQueryInput = string | SQLStatement
export type CursorQueryValues = ReadonlyArray<unknown> | undefined
export type CursorGeneratorOptions = QueryOptions & {
  batchSize?: number
  abortSignal?: AbortSignal
}
export type CursorHandlerOptions<Row> = CursorGeneratorOptions & {
  handler: (rows: Row[]) => Promise<void>
}
