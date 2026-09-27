export interface ScopeDefinition {
  audience: string
  surfaces: readonly string[]
  requires?: readonly string[]
  covers?: readonly string[]
}

type CompiledScopeDefinition = {
  audience: string
  surfaces: string[]
  requires: string[]
  covers: string[]
}

export type ScopeValidationCode =
  | 'duplicate-scope'
  | 'empty-scope-set'
  | 'missing-prerequisite'
  | 'mixed-audiences'
  | 'unsupported-surface'
  | 'unknown-scope'

export type ScopeValidationResult =
  | { valid: true; scopes: string[]; audiences: string[] }
  | { valid: false; code: ScopeValidationCode; scope?: string; requiredScope?: string }

export interface ScopeCatalog {
  hasScope(granted: readonly string[], required: string): boolean
  hasEveryScope(granted: readonly string[], required: readonly string[]): boolean
  expandPrerequisites(scopes: readonly string[]): string[]
  listScopesForAudience(audience: string, surface: string): string[]
  validateScopeSet(
    input: readonly string[],
    options: { surface: string; allowMixedAudiences: boolean },
  ): ScopeValidationResult
}

/** Compile a caller-owned scope graph; product grant and authorization decisions stay in callers. */
export function createScopeCatalog(definitions: Record<string, ScopeDefinition>): ScopeCatalog {
  const catalog = new Map<string, CompiledScopeDefinition>()
  for (const [scope, definition] of Object.entries(definitions)) {
    if (
      !scope ||
      !definition ||
      typeof definition.audience !== 'string' ||
      !definition.audience ||
      !Array.isArray(definition.surfaces) ||
      definition.surfaces.length === 0 ||
      definition.surfaces.some((surface) => typeof surface !== 'string' || !surface)
    ) {
      throw new TypeError(`Invalid scope definition for ${scope}`)
    }
    for (const edges of [definition.requires, definition.covers]) {
      if (
        edges !== undefined &&
        (!Array.isArray(edges) || edges.some((edge) => typeof edge !== 'string' || !edge))
      ) {
        throw new TypeError(`Invalid scope edges for ${scope}`)
      }
    }
    catalog.set(scope, {
      audience: definition.audience,
      surfaces: [...definition.surfaces],
      requires: [...(definition.requires ?? [])],
      covers: [...(definition.covers ?? [])],
    })
  }
  for (const relation of ['requires', 'covers'] as const) assertAcyclic(catalog, relation)

  function requireScope(scope: string): CompiledScopeDefinition {
    const definition = catalog.get(scope)
    if (!definition) throw new RangeError(`Unknown scope: ${scope}`)
    return definition
  }

  function expandPrerequisites(scopes: readonly string[]): string[] {
    const expanded = new Set<string>()
    function visit(scope: string): void {
      if (expanded.has(scope)) return
      const definition = requireScope(scope)
      expanded.add(scope)
      for (const required of definition.requires) visit(required)
    }
    for (const scope of scopes) visit(scope)
    return [...expanded].sort()
  }

  function covers(granted: string, required: string, visited: Set<string>): boolean {
    if (granted === required) return true
    if (visited.has(granted)) return false
    visited.add(granted)
    return requireScope(granted).covers.some((scope) => covers(scope, required, visited))
  }

  function hasScope(granted: readonly string[], required: string): boolean {
    requireScope(required)
    return granted.some((scope) => covers(scope, required, new Set()))
  }

  return {
    expandPrerequisites,
    hasScope,
    hasEveryScope(granted, required) {
      return required.every((scope) => hasScope(granted, scope))
    },
    listScopesForAudience(audience, surface) {
      return [...catalog]
        .filter(
          ([, definition]) =>
            definition.audience === audience && definition.surfaces.includes(surface),
        )
        .map(([scope]) => scope)
        .sort()
    },
    validateScopeSet(input, options) {
      if (input.length === 0) return { valid: false, code: 'empty-scope-set' }
      const seen = new Set<string>()
      for (const scope of input) {
        const definition = catalog.get(scope)
        if (!definition) return { valid: false, code: 'unknown-scope', scope }
        if (seen.has(scope)) return { valid: false, code: 'duplicate-scope', scope }
        if (!definition.surfaces.includes(options.surface)) {
          return { valid: false, code: 'unsupported-surface', scope }
        }
        seen.add(scope)
      }
      const scopes = [...seen].sort()
      for (const scope of scopes) {
        for (const requiredScope of requireScope(scope).requires) {
          if (!seen.has(requiredScope)) {
            return { valid: false, code: 'missing-prerequisite', scope, requiredScope }
          }
        }
      }
      const audiences = [...new Set(scopes.map((scope) => requireScope(scope).audience))].sort()
      if (!options.allowMixedAudiences && audiences.length > 1) {
        return { valid: false, code: 'mixed-audiences' }
      }
      return { valid: true, scopes, audiences }
    },
  }
}

function assertAcyclic(
  catalog: Map<string, CompiledScopeDefinition>,
  relation: 'requires' | 'covers',
): void {
  const done = new Set<string>()
  const active = new Set<string>()
  function visit(scope: string): void {
    if (!catalog.has(scope)) throw new RangeError(`Unknown ${relation} scope: ${scope}`)
    if (active.has(scope)) throw new RangeError(`Scope ${relation} cycle at ${scope}`)
    if (done.has(scope)) return
    active.add(scope)
    for (const next of catalog.get(scope)![relation]) visit(next)
    active.delete(scope)
    done.add(scope)
  }
  for (const scope of catalog.keys()) visit(scope)
}
