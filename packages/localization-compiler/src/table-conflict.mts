import { canonicalJson, compareCodePoints } from '@vouchington/localization'

export interface TableConflict {
  key: string
  ours: Record<string, unknown> | undefined
  theirs: Record<string, unknown> | undefined
}

export function serializeTableConflicts(
  rows: readonly Record<string, unknown>[],
  conflicts: readonly TableConflict[],
): string {
  const entries = [
    ...rows.map((row) => ({ key: tableKey(row), text: canonicalJson(row) })),
    ...conflicts.map((conflict) => ({
      key: conflict.key,
      text: [
        '<<<<<<< ours',
        conflict.ours === undefined ? '' : canonicalJson(conflict.ours),
        '=======',
        conflict.theirs === undefined ? '' : canonicalJson(conflict.theirs),
        '>>>>>>> theirs',
      ]
        .filter(Boolean)
        .join('\n'),
    })),
  ].toSorted((left, right) => compareCodePoints(left.key, right.key))
  return `[\n${entries.map((entry) => entry.text).join('\n')}\n]\n`
}

export function parseTableConflicts(text: string): {
  rows: Record<string, unknown>[]
  conflicts: TableConflict[]
} {
  const lines = text.trimEnd().split('\n')
  if (lines.shift() !== '[' || lines.pop() !== ']')
    throw new TypeError('Conflicted catalog table must retain its outer array')
  const rows: Record<string, unknown>[] = []
  const conflicts: TableConflict[] = []
  while (lines.length > 0) {
    const line = lines.shift()!
    if (line !== '<<<<<<< ours') {
      rows.push(parseRow(line))
      continue
    }
    const ours = takeConflictRow(lines, '=======')
    const theirs = takeConflictRow(lines, '>>>>>>> theirs')
    const row = ours ?? theirs
    if (row === undefined) throw new TypeError('Catalog conflict has no row')
    conflicts.push({ key: tableKey(row), ours, theirs })
  }
  return { rows, conflicts }
}

function takeConflictRow(lines: string[], delimiter: string): Record<string, unknown> | undefined {
  const line = lines.shift()
  if (line === delimiter) return undefined
  if (line === undefined) throw new TypeError(`Catalog conflict is missing ${delimiter}`)
  const row = parseRow(line)
  if (lines.shift() !== delimiter) throw new TypeError(`Catalog conflict is missing ${delimiter}`)
  return row
}
function parseRow(line: string): Record<string, unknown> {
  const value = JSON.parse(line) as unknown
  if (value === null || Array.isArray(value) || typeof value !== 'object')
    throw new TypeError('Catalog table rows must be JSON objects')
  return value as Record<string, unknown>
}
export function tableKey(row: Record<string, unknown>): string {
  return ['consumer', 'selectorId', 'alias', 'id']
    .map((key) => (typeof row[key] === 'string' ? row[key] : ''))
    .join('\t')
}
