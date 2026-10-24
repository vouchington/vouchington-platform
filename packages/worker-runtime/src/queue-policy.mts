import { assertSelectorSafeQueueName } from './selector-names.mts'

export interface QueuePolicyOptions {
  /**
   * Maps a group to the group that must contain all of its names (for example consumers that must
   * be a subset of an I/O group). Contained groups are exempt from the overlap check.
   */
  containedIn?: Readonly<Record<string, string>>
}

/**
 * Validates a queue policy object whose fields are exactly `groups`: each a nonempty array of
 * unique, canonical (untrimmed-free) queue names. Groups must not overlap, except groups declared
 * in `containedIn`, which must be subsets of their container.
 */
export function validateQueuePolicy(
  raw: unknown,
  groups: readonly string[],
  { containedIn = {} }: QueuePolicyOptions = {},
): Record<string, string[]> {
  const record = requireRecord(raw)
  const unknownFields = Object.keys(record).filter((field) => !groups.includes(field))
  if (unknownFields.length > 0) {
    throw new Error(`Queue policy has unsupported fields: ${unknownFields.join(', ')}`)
  }
  const policy: Record<string, string[]> = {}
  for (const group of groups) policy[group] = requireUniqueQueueNames(record[group], group)

  const exclusive = groups.filter((group) => !(group in containedIn))
  for (const [index, group] of exclusive.entries()) {
    for (const other of exclusive.slice(index + 1)) {
      const overlap = policy[group]!.filter((name) => policy[other]!.includes(name))
      if (overlap.length > 0)
        throw new Error(`Queue policy ${group} and ${other} overlap: ${overlap.join(', ')}`)
    }
  }
  for (const [group, container] of Object.entries(containedIn)) {
    const names = policy[group]
    const parent = policy[container]
    if (!names || !parent)
      throw new Error(`Queue policy containedIn names an unknown group: ${group}`)
    const outside = names.filter((name) => !parent.includes(name))
    if (outside.length > 0) {
      throw new Error(
        `Queue policy ${group} must be contained in ${container}: ${outside.join(', ')}`,
      )
    }
  }
  return policy
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Queue policy must be an object')
  }
  return value as Record<string, unknown>
}

function requireUniqueQueueNames(value: unknown, group: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Queue policy ${group} must be a nonempty array`)
  }
  if (value.some((name) => typeof name !== 'string' || name.trim().length === 0)) {
    throw new Error(`Queue policy ${group} must contain nonempty queue names`)
  }
  const names = value as string[]
  for (const name of names) assertSelectorSafeQueueName(name, group)
  if (names.some((name) => name !== name.trim())) {
    throw new Error(
      `Queue policy ${group} must contain canonical queue names without surrounding whitespace`,
    )
  }
  if (new Set(names).size !== names.length) {
    throw new Error(`Queue policy ${group} contains duplicate queue names`)
  }
  return names
}
