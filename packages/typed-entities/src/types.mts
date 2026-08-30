export type Normalizer = (value: string) => string | null

export type AliasOwner = {
  readonly alias: string
  readonly entityId: string | null
}

export type EntityMergePlan = {
  readonly aliases: readonly string[]
}

export type HostnameKind = 'primary' | 'additional'

export type HostnameClaim = {
  readonly entityId: string
  readonly hostname: string
  readonly kind: HostnameKind
}

export type HostnameClaimPlan = {
  readonly hostname: string
  readonly claim: HostnameClaim
  readonly releases: readonly HostnameClaim[]
  readonly write: boolean
}
