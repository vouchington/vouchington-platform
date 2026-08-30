import { normalizeKey } from '@vouchington/utils/strings'

import { AliasClaimedError, InvalidAliasError, InvalidEntityMergeError } from './errors.mts'
import type { AliasOwner, EntityMergePlan, Normalizer } from './types.mts'

export function normalizeAlias(value: string, normalize: Normalizer = defaultNormalizer): string {
  const alias = normalize(value)
  if (!alias) throw new InvalidAliasError(value)
  return alias
}

export function planAliasClaim(input: {
  readonly entityId: string
  readonly value: string
  readonly ownerId: string | null
  readonly normalize?: Normalizer
}): { readonly alias: string; readonly write: boolean } {
  const alias = normalizeAlias(input.value, input.normalize)
  if (input.ownerId !== null && input.ownerId !== input.entityId) {
    throw new AliasClaimedError(alias, input.ownerId)
  }
  return { alias, write: input.ownerId === null }
}

export function planAliasMerge(input: {
  readonly sourceId: string
  readonly destinationId: string
  readonly sourceSlug: string
  readonly sourceAliases: readonly string[]
  /** Ownership rows for candidate source aliases only. */
  readonly owners: readonly AliasOwner[]
  readonly normalize?: Normalizer
}): EntityMergePlan {
  if (input.sourceId === input.destinationId) {
    throw new InvalidEntityMergeError(input.sourceId, input.destinationId)
  }
  const aliases = [
    ...new Set(
      [input.sourceSlug, ...input.sourceAliases].map((value) =>
        normalizeAlias(value, input.normalize),
      ),
    ),
  ].toSorted()
  const candidates = new Set(aliases)
  for (const owner of input.owners) {
    const alias = normalizeAlias(owner.alias, input.normalize)
    const ownerId = owner.entityId
    if (
      candidates.has(alias) &&
      ownerId !== null &&
      ownerId !== input.sourceId &&
      ownerId !== input.destinationId
    ) {
      throw new AliasClaimedError(alias, ownerId)
    }
  }
  return { aliases }
}

function defaultNormalizer(value: string): string | null {
  return normalizeKey(value) || null
}
