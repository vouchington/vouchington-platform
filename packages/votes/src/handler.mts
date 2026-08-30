import { assertVoteScore, isVoteChoice } from './codec.mts'
import type { CreateVoteHandlerOptions, CurrentVote, VoteEvent, VoteMutation } from './types.mts'

export function createVoteHandler<
  TContext,
  TUser extends { readonly id: string },
  TEntity,
  TChoice extends string,
  TCurrent = CurrentVote,
  TResult = VoteEvent,
>(
  options: CreateVoteHandlerOptions<TContext, TUser, TEntity, TChoice, TCurrent, TResult>,
): (context: TContext) => Promise<void> {
  if (options.rateLimitPrefix && !options.checkRateLimit) {
    throw new Error('checkRateLimit is required when rateLimitPrefix is configured')
  }
  return async function handleVote(context: TContext): Promise<void> {
    const { adapter, messages } = options
    const entityId = adapter.getEntityId(context)
    adapter.assert(context, entityId && options.validateEntityId(entityId), 422, messages.invalidId)
    const safeEntityId = entityId!
    const user = await adapter.getCurrentUser(context)
    adapter.assert(context, user, 401, messages.unauthorized)
    const safeUser = user!
    if (options.routeKey) await adapter.applyRouteRateLimit(context, options.routeKey)
    await options.beforeEntity?.(context, safeUser)
    const entity = await options.getEntity(safeEntityId)
    adapter.assert(context, entity, 404, messages.notFound)
    const safeEntity = entity!
    await options.assertAccess?.(context, safeUser, safeEntity)
    const selected = options.clear
      ? { choice: null, score: null }
      : await getChoice(context, safeEntity, options)
    const audit = await adapter.getAudit(context)
    const rateLimitInput = options.rateLimitPrefix
      ? { prefix: options.rateLimitPrefix, user: safeUser, audit }
      : { user: safeUser, audit }
    const limited = await options.checkRateLimit?.(rateLimitInput)
    adapter.assert(context, limited !== true, 429, messages.limited)
    const upserted = await runLocked(options, safeUser, safeEntityId, async () => {
      const current = (await options.getCurrent?.(safeUser.id, safeEntityId)) ?? null
      const mutation: VoteMutation<TContext, TUser, TEntity, TChoice, TCurrent> = {
        context,
        user: safeUser,
        entity: safeEntity,
        entityId: safeEntityId,
        choice: selected.choice,
        score: selected.score,
        current,
        clear: options.clear === true,
      }
      if (options.getCurrent && isNoop(options, mutation)) {
        await options.onNoop?.(mutation)
        return null
      }
      await options.beforeMutation?.(mutation)
      const events = await options.upsert(
        safeUser.id,
        { entityId: safeEntityId, score: selected.score },
        audit,
      )
      if (events.length === 0) await options.onNoop?.(mutation)
      return events
    })
    if (upserted === null || upserted.length === 0) {
      adapter.setNoContent(context)
      return
    }
    await options.onVote?.(context, safeUser, safeEntity, upserted[0]!)
    adapter.setNoContent(context)
  }
}

export function createVoteClearHandler<
  TContext,
  TUser extends { readonly id: string },
  TEntity,
  TChoice extends string,
  TCurrent = CurrentVote,
  TResult = VoteEvent,
>(
  options: CreateVoteHandlerOptions<TContext, TUser, TEntity, TChoice, TCurrent, TResult>,
): (context: TContext) => Promise<void> {
  return createVoteHandler({ ...options, clear: true })
}

function runLocked<
  TContext,
  TUser extends { readonly id: string },
  TEntity,
  TChoice extends string,
  TCurrent,
  TResult,
>(
  options: CreateVoteHandlerOptions<TContext, TUser, TEntity, TChoice, TCurrent, TResult>,
  user: TUser,
  entityId: string,
  work: () => Promise<readonly TResult[] | null>,
): Promise<readonly TResult[] | null> {
  return options.withRequestLock ? options.withRequestLock(user.id, entityId, work) : work()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function getChoice<
  TContext,
  TUser extends { readonly id: string },
  TEntity,
  TChoice extends string,
  TCurrent,
  TResult,
>(
  context: TContext,
  entity: TEntity,
  options: CreateVoteHandlerOptions<TContext, TUser, TEntity, TChoice, TCurrent, TResult>,
) {
  const choiceCodec =
    typeof options.choiceCodec === 'function' ? options.choiceCodec(entity) : options.choiceCodec
  const body = await options.adapter.getBody(context)
  options.adapter.assert(context, isRecord(body), 422, options.messages.invalidBody)
  const choice = isRecord(body) ? body.choice : undefined
  options.adapter.assert(
    context,
    isVoteChoice(choiceCodec, choice),
    422,
    options.messages.invalidChoice,
  )
  const safeChoice = choice as TChoice
  const score = choiceCodec.scoreForChoice(safeChoice)
  assertVoteScore(score)
  return { choice: safeChoice, score }
}

function isNoop<
  TContext,
  TUser extends { readonly id: string },
  TEntity,
  TChoice extends string,
  TCurrent,
  TResult,
>(
  options: CreateVoteHandlerOptions<TContext, TUser, TEntity, TChoice, TCurrent, TResult>,
  mutation: VoteMutation<TContext, TUser, TEntity, TChoice, TCurrent>,
): boolean {
  if (options.isNoop) return options.isNoop(mutation)
  if (mutation.current === null) return mutation.score === null
  return readCurrentScore(mutation.current) === mutation.score
}

function readCurrentScore(current: unknown): unknown {
  return isRecord(current) ? current.score : undefined
}
