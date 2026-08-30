export { createTypedEntityEngine } from './engine.mts'
export {
  AliasClaimedError,
  EntityNotFoundError,
  HierarchyCycleError,
  HostnameClaimedError,
  InvalidAliasError,
  InvalidEntityMergeError,
  InvalidHostnameError,
  PolicyDeniedError,
  TypedEntityError,
  UnknownEntityTypeError,
} from './errors.mts'
export type { TypedEntityErrorCode } from './errors.mts'
export type {
  EntityPolicyInput,
  HostnameAssociation,
  HostnameClaim,
  HostnameResolution,
  HostnameValue,
  MergeInput,
  ParentInput,
  TypedEntity,
  TypedEntityCatalog,
  TypedEntityChange,
  TypedEntityEngineOptions,
  TypedEntityHooks,
  TypedEntityPolicy,
  TypedEntityStore,
  TypedEntityTransaction,
} from './types.mts'
