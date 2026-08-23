import { encodeCursor } from './cursors.mts'
import type { Cursor } from './types.mts'

export type PageInfo = {
  readonly hasNextPage: boolean
  readonly startCursor: string | null
  readonly endCursor: string | null
}

export function buildPageInfo<T>(
  items: readonly T[],
  options: { readonly hasNextPage: boolean; readonly getCursor: (item: T) => Cursor },
): PageInfo {
  const first = items[0]
  const last = items.at(-1)
  return {
    hasNextPage: options.hasNextPage,
    startCursor: first === undefined ? null : encodeCursor(options.getCursor(first)),
    endCursor:
      options.hasNextPage && last !== undefined ? encodeCursor(options.getCursor(last)) : null,
  }
}
