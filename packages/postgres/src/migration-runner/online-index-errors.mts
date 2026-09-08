export interface OnlineIndexContext {
  index: string
  migration: string
  table: string
}

export interface OnlineIndexRow {
  definition: string
  indisprimary: boolean
  indisready: boolean
  indisvalid: boolean
  indislive: boolean
  indisexclusion: boolean
  indisreplident: boolean
  relispartition: boolean
  relkind: string
  constrained: boolean
  extension_owned: boolean
  active: boolean
  target_match: boolean
}

export class OnlineIndexConflictError extends Error {
  readonly index: string
  readonly migration: string
  readonly table: string

  constructor(
    readonly reason: string,
    context: Partial<OnlineIndexContext> = {},
  ) {
    const migration = context.migration ?? '<unknown>'
    const table = context.table ?? '<unknown>'
    const index = context.index ?? '<unknown>'
    super(`Online index conflict: migration=${migration} table=${table} index=${index}: ${reason}`)
    this.name = 'OnlineIndexConflictError'
    this.migration = migration
    this.table = table
    this.index = index
  }
}

export function hasUnprovableIndexClause(statement: Record<string, unknown>): boolean {
  const params = [
    ...((statement.indexParams as unknown[]) ?? []),
    ...((statement.indexIncludingParams as unknown[]) ?? []),
  ]
  return params.some((param) => {
    const element = (param as { IndexElem?: Record<string, unknown> }).IndexElem
    return Boolean(element?.opclass || element?.collation)
  })
}

export function requireIndexName(
  statement: Record<string, unknown>,
  context: Pick<OnlineIndexContext, 'migration' | 'table'>,
): string {
  const index = statement.idxname
  if (typeof index !== 'string' || !index)
    throw new OnlineIndexConflictError('index name is not provable', context)
  return index
}
