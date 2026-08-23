export type EnvVarSensitivity = 'internal' | 'public' | 'secret'
export type EnvVarContract<Source extends string = string, Surface extends string = string> = {
  key: string
  name: string
  sensitivity: EnvVarSensitivity
  sourceOfTruth: Source
  surfaces: readonly Surface[]
}
export type EnvVarContractGroup<Source extends string = string, Surface extends string = string> = {
  sourceOfTruth: Source
  surfaces: readonly Surface[]
  sensitivity: EnvVarSensitivity
  names: readonly string[]
}

export function groupEnvContracts<Source extends string, Surface extends string>(
  sourceOfTruth: Source,
  sensitivity: EnvVarSensitivity,
  surfaces: readonly Surface[],
  names: readonly string[],
): EnvVarContractGroup<Source, Surface> {
  validatePart(sourceOfTruth, 'source')
  for (const surface of surfaces) validatePart(surface, 'surface')
  for (const name of names) validatePart(name, 'name')
  return { sourceOfTruth, sensitivity, surfaces: [...surfaces], names: [...names] }
}

export function normalizeEnvContractGroups<Source extends string, Surface extends string>(
  groups: readonly EnvVarContractGroup<Source, Surface>[],
): readonly EnvVarContract<Source, Surface>[] {
  const contract = groups.flatMap((group) => {
    validatePart(group.sourceOfTruth, 'source')
    for (const surface of group.surfaces) validatePart(surface, 'surface')
    for (const name of group.names) validatePart(name, 'name')
    return group.names.map((name) => ({
      key: `${group.sourceOfTruth}:${group.surfaces.join('+')}:${name}`,
      name,
      sensitivity: group.sensitivity,
      sourceOfTruth: group.sourceOfTruth,
      surfaces: Object.freeze([...group.surfaces]),
    }))
  })
  if (new Set(contract.map((entry) => entry.key)).size !== contract.length)
    throw new Error('Environment contract keys must be unique')
  return contract
}

function validatePart(value: string, label: string): void {
  if (!value || /[:+]/.test(value))
    throw new TypeError(`Environment contract ${label} cannot contain ':' or '+'`)
}

export function envNamesForSurface<Source extends string, Surface extends string>(
  contract: readonly EnvVarContract<Source, Surface>[],
  surface: Surface,
): readonly string[] {
  return contract.filter((entry) => entry.surfaces.includes(surface)).map((entry) => entry.name)
}

export function envContractsByName<Source extends string, Surface extends string>(
  contract: readonly EnvVarContract<Source, Surface>[],
): ReadonlyMap<string, readonly EnvVarContract<Source, Surface>[]> {
  const grouped = new Map<string, EnvVarContract<Source, Surface>[]>()
  for (const entry of contract) grouped.set(entry.name, [...(grouped.get(entry.name) ?? []), entry])
  return new Map([...grouped].map(([name, entries]) => [name, Object.freeze(entries)]))
}

export function envNamesBySensitivity<Source extends string, Surface extends string>(
  contract: readonly EnvVarContract<Source, Surface>[],
  sensitivity: EnvVarSensitivity,
): readonly string[] {
  return [
    ...new Set(
      contract.filter((entry) => entry.sensitivity === sensitivity).map((entry) => entry.name),
    ),
  ].toSorted()
}
