import { createAliasOperations } from './aliases.mts'
import { createHierarchyOperations } from './hierarchy.mts'
import { createHostnameOperations } from './hostnames.mts'
import { createRuntime } from './runtime.mts'
import type { TypedEntity, TypedEntityEngineOptions } from './types.mts'

export function createTypedEntityEngine<
  TType extends string,
  TEntity extends TypedEntity<TType>,
  TContext,
>(options: TypedEntityEngineOptions<TType, TEntity, TContext>) {
  const runtime = createRuntime(options)
  return {
    ...createAliasOperations(runtime),
    ...createHierarchyOperations(runtime),
    ...createHostnameOperations(runtime),
  }
}
