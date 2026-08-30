import type { QueryExecutor, QueryOptions } from '@vouchington/postgres'
import type { PageInfo } from '@vouchington/pagination'

export type { PageInfo } from '@vouchington/pagination'

export type VoteScore = number | null

export type VoteInput = { readonly entityId: string; readonly score: VoteScore }

export type VoteAudit = {
  readonly ipAddress?: string | null
  readonly deviceId?: string | null
  readonly sessionId?: string | null
  readonly userAgent?: string | null
}

export type VoteEvent = {
  readonly id: string
  readonly entityId: string
  readonly userId: string
  readonly score: VoteScore
  readonly previousScore: VoteScore
  readonly createdAt: Date
}

export type CurrentVote = Omit<VoteEvent, 'previousScore'>

export type VotePage = { readonly results: readonly CurrentVote[]; readonly pageInfo: PageInfo }

export type VoteStoreOptions = {
  readonly table: string
  readonly entityIdColumn: string
  readonly cursorScope?: string
  readonly resolveUserAgentId?: (userAgent: string, query: QueryExecutor) => Promise<string | null>
}

export type VoteStore = {
  readonly upsert: (
    userId: string,
    votes: readonly VoteInput[],
    audit?: VoteAudit,
    options?: QueryOptions,
  ) => Promise<readonly VoteEvent[]>
  readonly clear: (
    userId: string,
    entityId: string,
    audit?: VoteAudit,
    options?: QueryOptions,
  ) => Promise<readonly VoteEvent[]>
  readonly getCurrent: (userId: string, entityId: string) => Promise<CurrentVote | null>
  readonly getByUser: (
    userId: string,
    entityIds?: readonly string[],
  ) => Promise<readonly CurrentVote[]>
  readonly listByUser: (userId: string, options: VotePageOptions) => Promise<VotePage>
  readonly listByEntity: (entityId: string, options: VotePageOptions) => Promise<VotePage>
  readonly listByUserForEntity: (
    userId: string,
    entityId: string,
    options: VotePageOptions,
  ) => Promise<VotePage>
}

export type VotePageOptions = { readonly limit: number; readonly after?: string }

export type VoteChoiceCodec<TChoice extends string> = {
  readonly choices: readonly TChoice[]
  readonly scoreForChoice: (choice: TChoice) => VoteScore
}

export type VoteHandlerAdapter<TContext, TUser> = {
  readonly getEntityId: (context: TContext) => string | undefined
  readonly getCurrentUser: (context: TContext) => Promise<TUser | null>
  readonly getBody: (context: TContext) => Promise<unknown>
  readonly getAudit: (context: TContext) => Promise<VoteAudit>
  readonly assert: (context: TContext, condition: unknown, status: number, message: string) => void
  readonly applyRouteRateLimit: (context: TContext, key: string) => Promise<void>
  readonly setNoContent: (context: TContext) => void
}

export type VoteMutation<
  TContext,
  TUser,
  TEntity,
  TChoice extends string,
  TCurrent = CurrentVote,
> = {
  readonly context: TContext
  readonly user: TUser
  readonly entity: TEntity
  readonly entityId: string
  readonly choice: TChoice | null
  readonly score: VoteScore
  readonly current: TCurrent | null
  readonly clear: boolean
}

export type CreateVoteHandlerOptions<
  TContext,
  TUser extends { readonly id: string },
  TEntity,
  TChoice extends string,
  TCurrent = CurrentVote,
  TResult = VoteEvent,
> = {
  readonly adapter: VoteHandlerAdapter<TContext, TUser>
  readonly routeKey?: string
  readonly rateLimitPrefix?: string
  readonly clear?: boolean
  readonly validateEntityId: (id: string) => boolean
  readonly choiceCodec: VoteChoiceCodec<TChoice> | ((entity: TEntity) => VoteChoiceCodec<TChoice>)
  readonly getEntity: (id: string) => Promise<TEntity | null>
  readonly upsert: (
    userId: string,
    vote: VoteInput,
    audit: VoteAudit,
  ) => Promise<readonly TResult[]>
  readonly messages: {
    readonly invalidId: string
    readonly unauthorized: string
    readonly notFound: string
    readonly invalidBody: string
    readonly invalidChoice: string
    readonly limited: string
  }
  readonly beforeEntity?: (context: TContext, user: TUser) => Promise<void> | void
  readonly assertAccess?: (context: TContext, user: TUser, entity: TEntity) => Promise<void> | void
  readonly getCurrent?: (userId: string, entityId: string) => Promise<TCurrent | null>
  readonly withRequestLock?: <Result>(
    userId: string,
    entityId: string,
    work: () => Promise<Result>,
  ) => Promise<Result>
  readonly beforeMutation?: (
    mutation: VoteMutation<TContext, TUser, TEntity, TChoice, TCurrent>,
  ) => Promise<void> | void
  readonly isNoop?: (mutation: VoteMutation<TContext, TUser, TEntity, TChoice, TCurrent>) => boolean
  readonly onNoop?: (
    mutation: VoteMutation<TContext, TUser, TEntity, TChoice, TCurrent>,
  ) => Promise<void> | void
  readonly onVote?: (
    context: TContext,
    user: TUser,
    entity: TEntity,
    vote: TResult,
  ) => Promise<void> | void
  readonly checkRateLimit?: (input: {
    readonly prefix?: string
    readonly user: TUser
    readonly audit: VoteAudit
  }) => Promise<boolean>
}
