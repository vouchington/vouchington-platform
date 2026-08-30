import { HierarchyCycleError } from './errors.mts'

export function assertAcyclicParent(input: {
  readonly entityId: string
  readonly parentId: string
  readonly ancestorIds: readonly string[]
}): void {
  if (input.entityId === input.parentId || input.ancestorIds.includes(input.entityId)) {
    throw new HierarchyCycleError(input.entityId, input.parentId)
  }
}
