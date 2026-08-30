export { normalizeAlias, planAliasClaim, planAliasMerge } from './aliases.mts'
export {
  AliasClaimedError,
  HierarchyCycleError,
  HostnameClaimedError,
  InvalidAliasError,
  InvalidEntityMergeError,
  InvalidHostnameClaimError,
  InvalidHostnameError,
  TypedEntityError,
} from './errors.mts'
export { assertAcyclicParent } from './hierarchy.mts'
export { normalizeHostname, planHostnameClaim } from './hostnames.mts'
export type { TypedEntityErrorCode } from './errors.mts'
export type {
  AliasOwner,
  EntityMergePlan,
  HostnameClaim,
  HostnameClaimPlan,
  HostnameKind,
  Normalizer,
} from './types.mts'
