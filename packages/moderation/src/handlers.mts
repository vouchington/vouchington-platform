import type { Context, Handler } from '@jongleberry/api-server'
import type { Awaitable } from './types.mts'

interface AuthorizedOptions<TUser, TInput> {
  authenticate(context: Context): Awaitable<TUser>
  parse(context: Context): Awaitable<TInput>
  authorize(context: Context, user: TUser, input: TInput): Awaitable<void>
}

export function createReportSubmitHandler<TUser, TInput, TResult, TResponse>(
  options: AuthorizedOptions<TUser, TInput> & {
    verifyPreconditions(context: Context, user: TUser, input: TInput): Awaitable<void>
    submit(user: TUser, input: TInput): Awaitable<{ result: TResult; duplicate: boolean }>
    serialize(result: TResult, duplicate: boolean): Awaitable<TResponse>
  },
): Handler {
  return async (context) => {
    const user = await options.authenticate(context)
    const input = await options.parse(context)
    await options.authorize(context, user, input)
    await options.verifyPreconditions(context, user, input)
    const { result, duplicate } = await options.submit(user, input)
    context.setStatus(duplicate ? 200 : 201)
    context.json(await options.serialize(result, duplicate))
  }
}

export function createReportResolveHandler<TUser, TInput, TResult, TResponse>(
  options: AuthorizedOptions<TUser, TInput> & {
    resolve(user: TUser, input: TInput): Awaitable<TResult>
    serialize(result: TResult): Awaitable<TResponse>
  },
): Handler {
  return createJsonHandler(
    options,
    (user, input) => options.resolve(user, input),
    (result) => options.serialize(result),
  )
}

export function createQueueClaimHandler<TUser, TInput, TResult, TResponse>(
  options: AuthorizedOptions<TUser, TInput> & {
    claim(user: TUser, input: TInput): Awaitable<TResult>
    serialize(result: TResult): Awaitable<TResponse>
  },
): Handler {
  return createJsonHandler(
    options,
    (user, input) => options.claim(user, input),
    (result) => options.serialize(result),
  )
}

export function createQueueReleaseHandler<TUser, TInput>(
  options: AuthorizedOptions<TUser, TInput> & {
    release(user: TUser, input: TInput): Awaitable<void>
  },
): Handler {
  return async (context) => {
    const user = await options.authenticate(context)
    const input = await options.parse(context)
    await options.authorize(context, user, input)
    await options.release(user, input)
    context.setStatus(204)
  }
}

function createJsonHandler<TUser, TInput, TResult, TResponse>(
  options: AuthorizedOptions<TUser, TInput>,
  execute: (user: TUser, input: TInput) => Awaitable<TResult>,
  serialize: (result: TResult) => Awaitable<TResponse>,
): Handler {
  return async (context) => {
    const user = await options.authenticate(context)
    const input = await options.parse(context)
    await options.authorize(context, user, input)
    context.json(await serialize(await execute(user, input)))
  }
}
