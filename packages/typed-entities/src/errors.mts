export type TypedEntityErrorCode =
  | 'ALIAS_CLAIMED'
  | 'ENTITY_MERGE_INVALID'
  | 'HIERARCHY_CYCLE'
  | 'HOSTNAME_CLAIMED'
  | 'HOSTNAME_CLAIM_INVALID'
  | 'INVALID_ALIAS'
  | 'INVALID_HOSTNAME'

export class TypedEntityError extends Error {
  constructor(
    readonly code: TypedEntityErrorCode,
    message: string,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class InvalidEntityMergeError extends TypedEntityError {
  constructor(
    readonly sourceId: string,
    readonly targetId: string,
  ) {
    super('ENTITY_MERGE_INVALID', `Entity cannot be merged: ${sourceId} -> ${targetId}`)
  }
}

export class InvalidAliasError extends TypedEntityError {
  constructor(readonly alias: string) {
    super('INVALID_ALIAS', `Invalid alias: ${alias}`)
  }
}

export class AliasClaimedError extends TypedEntityError {
  constructor(
    readonly alias: string,
    readonly entityId: string,
  ) {
    super('ALIAS_CLAIMED', `Alias is already claimed: ${alias}`)
  }
}

export class HostnameClaimedError extends TypedEntityError {
  constructor(
    readonly hostname: string,
    readonly entityId: string,
  ) {
    super('HOSTNAME_CLAIMED', `Hostname is already claimed: ${hostname}`)
  }
}

export class InvalidHostnameError extends TypedEntityError {
  constructor(readonly hostname: string) {
    super('INVALID_HOSTNAME', `Invalid ASCII hostname: ${hostname}`)
  }
}

export class InvalidHostnameClaimError extends TypedEntityError {
  constructor(
    readonly hostname: string,
    message: string,
  ) {
    super('HOSTNAME_CLAIM_INVALID', `Invalid hostname claim for ${hostname}: ${message}`)
  }
}

export class HierarchyCycleError extends TypedEntityError {
  constructor(
    readonly entityId: string,
    readonly parentId: string,
  ) {
    super('HIERARCHY_CYCLE', `Parent would create a hierarchy cycle: ${entityId} -> ${parentId}`)
  }
}
