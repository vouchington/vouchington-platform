export type QueueSelection =
  | { mode: 'all'; queueNames: ReadonlySet<string> }
  | { mode: 'include'; queueNames: ReadonlySet<string> }
  | { mode: 'exclude'; queueNames: ReadonlySet<string> }

export interface QueueSelectionOptions {
  dropUnknownIncludes?: boolean
  /** Called with dropped include-mode queue names when tolerant selection is enabled. */
  onUnknownIncludes?: (unknownQueueNames: readonly string[]) => void
}

export function parseQueueSelection(
  value: string | undefined,
  knownQueueNames: readonly string[],
  { dropUnknownIncludes = false, onUnknownIncludes }: QueueSelectionOptions = {},
): QueueSelection {
  const known = new Set(knownQueueNames)
  const trimmed = value?.trim()
  if (!trimmed) return { mode: 'all', queueNames: new Set() }

  const parts = trimmed.split(',').map((part) => part.trim())
  if (parts.some((part) => part.length === 0)) {
    throw new Error('QUEUES must be a comma-separated list without empty entries')
  }

  const excludes = parts.map((part) => part.startsWith('-'))
  const isExclude = excludes.every(Boolean)
  if (!isExclude && !excludes.every((exclude) => !exclude)) {
    throw new Error('QUEUES must use either all include entries or all exclude entries, not both')
  }

  const parsedNames = parts.map((part) => (isExclude ? part.slice(1) : part))
  if (parsedNames.includes('')) {
    throw new Error('QUEUES exclude entries must include a queue name after "-"')
  }

  const unknown = parsedNames.filter((queueName) => !known.has(queueName))
  if (!isExclude && !dropUnknownIncludes && unknown.length > 0) {
    throw new Error(`QUEUES contains unknown queue name(s): ${unknown.join(', ')}`)
  }
  if (!isExclude && dropUnknownIncludes && unknown.length > 0) onUnknownIncludes?.(unknown)

  return {
    mode: isExclude ? 'exclude' : 'include',
    queueNames: new Set(
      isExclude || dropUnknownIncludes
        ? parsedNames.filter((name) => known.has(name))
        : parsedNames,
    ),
  }
}

export function isQueueSelected(selection: QueueSelection, queueName: string): boolean {
  switch (selection.mode) {
    case 'all':
      return true
    case 'include':
      return selection.queueNames.has(queueName)
    case 'exclude':
      return !selection.queueNames.has(queueName)
  }
}
