import { useCallback, useMemo, useState } from 'react'

const EMPTY_REMOVALS: ReadonlySet<string> = new Set()

/**
 * Tracks optimistically removed item IDs scoped to a paginated `queryKey`. When `queryKey`
 * changes, `removedIds` resets immediately without an effect pass.
 */
export function useQueryScopedRemovals(queryKey: string): {
  remove: (id: string) => void
  removedIds: ReadonlySet<string>
} {
  const queryToken = useMemo(() => ({ queryKey }), [queryKey])
  const [state, setState] = useState<{
    queryToken: { queryKey: string }
    ids: ReadonlySet<string>
  }>(() => ({ queryToken, ids: EMPTY_REMOVALS }))

  const removedIds = state.queryToken === queryToken ? state.ids : EMPTY_REMOVALS
  const remove = useCallback(
    (id: string) => {
      setState((previous) => {
        const ids = new Set(previous.queryToken === queryToken ? previous.ids : EMPTY_REMOVALS)
        ids.add(id)
        return { queryToken, ids }
      })
    },
    [queryToken],
  )

  return { remove, removedIds }
}
