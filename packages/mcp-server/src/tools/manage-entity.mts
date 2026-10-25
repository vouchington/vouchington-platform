import { objectSchema, successSchema } from '../schema/index.mts'
import type { McpTool, McpToolMeta, ToolApiEndpoint, ToolOutputSchema } from '../types.mts'
import { selectApiByArgument } from './select-api.mts'

/** A request the caller got wrong, carrying the HTTP status an error mapper can read. */
export class ManageEntityInputError extends Error {
  override readonly name = 'ManageEntityInputError'
  readonly status = 422
  readonly statusCode = 422
  readonly expose = true
}

type AddArgs<TAdd extends Record<string, unknown>> = { action: 'add' } & TAdd
type UpdateArgs<TUpdate extends Record<string, unknown>> = {
  action: 'update'
  id: string
} & Partial<TUpdate>
type RemoveArgs = { action: 'remove'; id: string }
export type ManageEntityArgs<
  TAdd extends Record<string, unknown>,
  TUpdate extends Record<string, unknown>,
> = AddArgs<TAdd> | UpdateArgs<TUpdate> | RemoveArgs
export type ManageEntityResult = { success: true; result: unknown }

export type ManageEntityToolConfig<
  TAdd extends Record<string, unknown>,
  TUpdate extends Record<string, unknown>,
  TUser,
  TActiveUser,
  TMeta extends McpToolMeta = McpToolMeta,
> = {
  toolName: string
  description: string
  addProperties: Record<string, unknown>
  updateProperties: Record<string, unknown>
  /** Resolves the caller to the user the mutations act for, or throws to refuse the call. */
  requireUser: (user: TUser) => Promise<TActiveUser> | TActiveUser
  addFn: (user: TActiveUser, args: AddArgs<TAdd>) => Promise<unknown>
  updateFn: (user: TActiveUser, args: UpdateArgs<TUpdate>) => Promise<unknown>
  removeFn: (user: TActiveUser, id: string) => Promise<unknown>
  /** The entity `addFn` and `updateFn` return, as an output schema. Required with `meta`. */
  entitySchema?: ToolOutputSchema
  /** Published metadata. `selectApi` and `outputSchema` are derived and replace any given. */
  meta?: TMeta
}

/** Add, update and remove actions behind one tool, with REST route selection per action. */
export function createManageEntityTool<
  TAdd extends Record<string, unknown>,
  TUpdate extends Record<string, unknown>,
  TUser = unknown,
  TActiveUser = TUser,
  TContext = unknown,
  TMeta extends McpToolMeta = McpToolMeta,
>(
  config: ManageEntityToolConfig<TAdd, TUpdate, TUser, TActiveUser, TMeta>,
): McpTool<
  TUser,
  TContext,
  ManageEntityArgs<TAdd, TUpdate>,
  ManageEntityResult,
  readonly [],
  TMeta
> {
  const meta = config.meta && {
    ...config.meta,
    selectApi: selectApiByArgument('action', actionEndpoints(config.meta.api ?? [])),
    outputSchema: deriveOutputSchema(config.toolName, config.entitySchema),
  }
  return {
    schema: {
      name: config.toolName,
      type: 'function',
      description: config.description,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'remove'] },
          id: { type: 'string', description: 'Required for update and remove actions.' },
          ...config.addProperties,
          ...config.updateProperties,
        },
        required: ['action'],
      },
      strict: null,
    },
    ...(meta ? { meta: meta as TMeta } : {}),
    function: (user) => async (args) => {
      const active = await config.requireUser(user)
      switch (args.action) {
        case 'add':
          return { success: true, result: await config.addFn(active, args) }
        case 'update':
          if (!args.id) throw new ManageEntityInputError('id is required for update')
          return { success: true, result: await config.updateFn(active, args) }
        case 'remove':
          if (!args.id) throw new ManageEntityInputError('id is required for remove')
          await config.removeFn(active, args.id)
          // A service may return the deleted row. Only its identity is a stable result.
          return { success: true, result: { id: args.id } }
        default:
          throw new ManageEntityInputError(
            `Unsupported action: ${String((args as { action?: unknown }).action)}`,
          )
      }
    },
  }
}

const ACTION_METHODS = { add: 'POST', update: 'PATCH', remove: 'DELETE' } as const

// Each action calls the REST route of its method, so a call charges only that route's bucket.
function actionEndpoints(api: readonly ToolApiEndpoint[]): Record<string, ToolApiEndpoint> {
  return Object.fromEntries(
    Object.entries(ACTION_METHODS).flatMap(([action, method]) => {
      const endpoint = api.find((candidate) => candidate.method === method)
      return endpoint ? [[action, endpoint]] : []
    }),
  )
}

// The results above and their schema live side by side, so they change together. Add and update
// return the entity view, remove returns the id it deleted.
function deriveOutputSchema(toolName: string, entity: ToolOutputSchema | undefined) {
  if (!entity) throw new Error(`${toolName} must provide the entity schema its results return`)
  // The entity's own definitions move to the envelope root, where its references resolve.
  const { $defs, ...body } = entity
  const schema = successSchema({
    result: { oneOf: [body, objectSchema({ id: { type: 'string' } })] },
  })
  return $defs ? { ...schema, $defs } : schema
}
