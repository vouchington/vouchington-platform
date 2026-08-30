import type { Context } from '@jongleberry/api-server'

import { createVoteClearHandler, createVoteHandler } from './handler.mts'
import type {
  CreateVoteHandlerOptions,
  CurrentVote,
  VoteAudit,
  VoteEvent,
  VoteHandlerAdapter,
} from './types.mts'

export type ApiServerVoteContext = Context & {
  getCurrentUser: () => Promise<unknown>
  getSessionTokenData: () => Promise<{ did?: string; sid?: string } | null>
  applyRouteRateLimit: (key: string) => Promise<void>
}

export type ApiServerVoteHandlerOptions<
  TUser extends { readonly id: string },
  TEntity,
  TChoice extends string,
  TCurrent = CurrentVote,
  TResult = VoteEvent,
> = Omit<
  CreateVoteHandlerOptions<ApiServerVoteContext, TUser, TEntity, TChoice, TCurrent, TResult>,
  'adapter' | 'clear'
>

export function createApiServerVoteAdapter<TUser extends { id: string }>(): VoteHandlerAdapter<
  ApiServerVoteContext,
  TUser
> {
  return {
    getEntityId: (context) => context.params.id,
    getCurrentUser: (context) => context.getCurrentUser() as Promise<TUser | null>,
    getBody: (context) => context.request.json('10kb'),
    getAudit: async (context) => getAudit(context),
    assert: (context, condition, status, message) => context.assert(condition, status, message),
    applyRouteRateLimit: (context, key) => context.applyRouteRateLimit(key),
    setNoContent: (context) => context.setStatus(204),
  }
}

export function createApiServerVoteHandler<
  TUser extends { readonly id: string },
  TEntity,
  TChoice extends string,
  TCurrent = CurrentVote,
  TResult = VoteEvent,
>(options: ApiServerVoteHandlerOptions<TUser, TEntity, TChoice, TCurrent, TResult>) {
  return createVoteHandler({ ...options, adapter: createApiServerVoteAdapter<TUser>() })
}

export function createApiServerVoteClearHandler<
  TUser extends { readonly id: string },
  TEntity,
  TChoice extends string,
  TCurrent = CurrentVote,
  TResult = VoteEvent,
>(options: ApiServerVoteHandlerOptions<TUser, TEntity, TChoice, TCurrent, TResult>) {
  return createVoteClearHandler({ ...options, adapter: createApiServerVoteAdapter<TUser>() })
}

async function getAudit(context: ApiServerVoteContext): Promise<VoteAudit> {
  const session = await context.getSessionTokenData()
  const headers = context.req.headers as Record<string, string | string[] | undefined>
  const userAgent = headers['user-agent']
  return {
    ipAddress: context.ip ?? null,
    deviceId: session?.did ?? null,
    sessionId: session?.sid ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
  }
}
