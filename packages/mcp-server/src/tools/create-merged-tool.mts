import {
  closeDeclaredInputObjects,
  factorToolSchema,
  findSchemaViolation,
} from '../schema/index.mts'
import type { McpTool, McpToolMeta, McpToolSchema, ToolOutputSchema } from '../types.mts'
import { mergeOutputBranches } from './merged-output.mts'
import { scopedSchema } from './scoped-schema.mts'

export type MergedToolSource<
  TUser = unknown,
  TContext = unknown,
  TArgs = never,
  TResult = unknown,
  TMeta extends McpToolMeta = McpToolMeta,
> = Pick<McpTool<TUser, TContext, TArgs, TResult, readonly [], TMeta>, 'function' | 'roles'> & {
  schema: Pick<McpToolSchema, 'parameters' | 'description'>
  meta?: TMeta
}

export type MergedToolOption<
  TUser = unknown,
  TContext = unknown,
  TArgs = never,
  TResult = unknown,
  TMeta extends McpToolMeta = McpToolMeta,
> = {
  option: string
  source: MergedToolSource<TUser, TContext, TArgs, TResult, TMeta>
}

export type MergedToolConfig<TUser, TContext, TMeta extends McpToolMeta = McpToolMeta> = {
  /**
   * A string that is equal for two sources exactly when they may share one tool. Include every
   * declared field the application authorizes on (scopes, audience, plan, roles, annotations):
   * merging sources that differ would let one option inherit another's gates.
   */
  compatibilityKey: (source: MergedToolSource<TUser, TContext, never, unknown, TMeta>) => string
}

/** One MCP name, with each source tool's validator, handler and REST route selection retained. */
export function createMergedTool<
  TUser = unknown,
  TContext = unknown,
  TMeta extends McpToolMeta = McpToolMeta,
>(
  name: string,
  title: string,
  options: readonly MergedToolOption<TUser, TContext, never, unknown, TMeta>[],
  { compatibilityKey }: MergedToolConfig<TUser, TContext, TMeta>,
): McpTool<TUser, TContext, unknown, unknown, readonly [], TMeta> {
  if (options.length < 1) throw new Error(`${name} needs at least one option`)
  const first = options[0]!.source
  if (!first.meta?.outputSchema) throw new Error(`${name} needs source output schemas`)
  const byOption = new Map(options.map((entry) => [entry.option, entry.source]))
  if (byOption.size !== options.length) throw new Error(`${name} has duplicate options`)
  for (const { source } of options) {
    if (!source.meta?.outputSchema || compatibilityKey(source) !== compatibilityKey(first)) {
      throw new Error(`${name} source tools have incompatible declared metadata`)
    }
  }

  const inputBranches = options.map(({ option, source }, index) => {
    const scoped = scopedSchema(
      closeDeclaredInputObjects(source.schema.parameters ?? { type: 'object', properties: {} }),
      index,
    )
    return {
      body: {
        type: 'object',
        properties: { option: { enum: [option] }, arguments: scoped.body },
        required: ['option', 'arguments'],
        additionalProperties: false,
      },
      definitions: scoped.definitions,
    }
  })
  const output = mergeOutputBranches(
    options.map(({ option, source }) => ({ option, outputSchema: source.meta!.outputSchema! })),
  )
  const allRoutes = options.flatMap(({ source }) => source.meta?.api ?? [])
  const api = [
    ...new Map(allRoutes.map((route) => [`${route.method}:${route.path}`, route])).values(),
  ]
  const selected = (args: Record<string, unknown>) => byOption.get(args['option'] as string)
  const parameters = factorToolSchema({
    type: 'object',
    oneOf: inputBranches.map((entry) => entry.body),
    $defs: Object.assign({}, ...inputBranches.map((entry) => entry.definitions)),
  })
  return {
    ...(first.roles ? { roles: first.roles } : {}),
    schema: {
      name,
      type: 'function',
      description: options
        .map(({ option, source }) => `${option}: ${source.schema.description ?? ''}`)
        .join('\n'),
      parameters,
      strict: null,
    },
    meta: {
      ...first.meta,
      title,
      api: api.length ? api : null,
      optionOutputPointers: Object.fromEntries(
        [...output.indexes].map(([option, index]) => [
          option,
          output.branches.length === 1 ? '#' : `#/anyOf/${index}`,
        ]),
      ),
      outputSchema: factorToolSchema({
        ...(output.branches.length === 1
          ? output.branches[0]
          : { type: 'object', anyOf: output.branches }),
        ...(Object.keys(output.definitions).length ? { $defs: output.definitions } : {}),
      }) as ToolOutputSchema,
      selectApi: (args) => {
        const source = selected(args)
        if (!source) return []
        const optionArguments = args['arguments'] as Record<string, unknown>
        return source.meta?.selectApi?.(optionArguments) ?? source.meta?.api ?? []
      },
      selectOutputSchema: (args) => {
        const source = selected(args)
        const optionArguments = args['arguments'] as Record<string, unknown>
        // A source that is itself a merged tool narrows to its own selected option.
        return source?.meta?.selectOutputSchema?.(optionArguments) ?? source?.meta?.outputSchema
      },
      auditOption: (args) => (selected(args) ? (args['option'] as string) : null),
    } as TMeta,
    function: (user) => (args, context) => {
      const violation = findSchemaViolation(parameters, args)
      if (violation) throw new Error(`Invalid merged tool arguments: ${violation}`)
      const input = args as { option: string; arguments: unknown }
      const source = byOption.get(input.option)
      /* v8 ignore next -- schema validation has already refused any unlisted option */
      if (!source) throw new Error(`${name} received an unknown option`)
      return source.function(user)(input.arguments as never, context)
    },
  }
}
