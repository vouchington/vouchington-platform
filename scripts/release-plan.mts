import semver from 'semver'

import {
  dependencyFields,
  indexAndValidate,
  normalizedRange,
  publishedFields,
  rangeIncludes,
  topologicalOrder,
  type WorkspacePackage,
} from './release-workspace.mts'

export { loadWorkspacePackages, type WorkspacePackage } from './release-workspace.mts'

export const releaseTypes = ['patch', 'minor', 'major'] as const
export type ReleaseType = (typeof releaseTypes)[number]

interface PlannedRelease {
  bump: ReleaseType
  directory: string
  fromVersion: string
  name: string
  toVersion: string
}

export interface WorkspaceReleasePlan {
  changedManifests: string[]
  packages: WorkspacePackage[]
  releases: PlannedRelease[]
  selectedPackage: string
}

export type StoredReleasePlan = Omit<WorkspaceReleasePlan, 'packages'>

const bumpStrength: Record<ReleaseType, number> = { patch: 1, minor: 2, major: 3 }

export function planWorkspaceRelease(
  input: WorkspacePackage[],
  selectedPackage: string,
  releaseType: ReleaseType,
): WorkspaceReleasePlan {
  if (!releaseTypes.includes(releaseType))
    throw new Error(`Unsupported release type: ${releaseType}`)
  const packages = structuredClone(input) as WorkspacePackage[]
  const byName = indexAndValidate(packages)
  const selected = byName.get(selectedPackage)
  if (!selected) throw new Error(`Unknown workspace package: ${selectedPackage}`)
  if (selected.manifest.private)
    throw new Error(`Cannot release private package: ${selectedPackage}`)
  const bumps = new Map<string, ReleaseType>([[selectedPackage, releaseType]])
  let updated = true
  while (updated) {
    updated = false
    const targets = targetVersions(bumps, byName)
    for (const candidate of packages) {
      for (const field of publishedFields) {
        for (const [dependency, range] of Object.entries(candidate.manifest[field] ?? {})) {
          const target = targets.get(dependency)
          const dependencyVersion = byName.get(dependency)?.manifest.version
          if (!target || rangeIncludes(range, target, dependencyVersion)) continue
          if (candidate.manifest.private)
            throw new Error(
              `Cannot cascade a release to private dependent ${candidate.manifest.name}`,
            )
          const dependencyBump = bumps.get(dependency)!
          const current = bumps.get(candidate.manifest.name)
          const strongest = strongerBump(current, dependencyBump)
          if (current === strongest) continue
          bumps.set(candidate.manifest.name, strongest)
          updated = true
        }
      }
    }
  }

  const targets = targetVersions(bumps, byName)
  const changed = new Set<string>()
  for (const workspacePackage of packages) {
    const { manifest } = workspacePackage
    const ownTarget = targets.get(manifest.name)
    if (ownTarget && ownTarget !== manifest.version) {
      manifest.version = ownTarget
      changed.add(manifestPath(workspacePackage))
    }
    for (const field of dependencyFields) {
      for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
        const target = targets.get(dependency)
        const dependencyVersion = byName.get(dependency)?.manifest.version
        if (!target || rangeIncludes(range, target, dependencyVersion)) continue
        manifest[field]![dependency] = normalizedRange(range, target)
        changed.add(manifestPath(workspacePackage))
      }
    }
  }

  const orderedNames = topologicalOrder(bumps.keys(), byName)
  const releases = orderedNames.map((name) => {
    const workspacePackage = byName.get(name)!
    return {
      bump: bumps.get(name)!,
      directory: workspacePackage.directory,
      fromVersion: input.find(({ manifest }) => manifest.name === name)!.manifest.version,
      name,
      toVersion: targets.get(name)!,
    }
  })
  return {
    changedManifests: [...changed].toSorted(),
    packages,
    releases,
    selectedPackage,
  }
}

function targetVersions(
  bumps: Map<string, ReleaseType>,
  byName: Map<string, WorkspacePackage>,
): Map<string, string> {
  return new Map(
    [...bumps].map(([name, bump]) => {
      const target = semver.inc(byName.get(name)!.manifest.version, bump)
      if (!target) throw new Error(`Cannot apply ${bump} to ${name}`)
      return [name, target]
    }),
  )
}

function strongerBump(current: ReleaseType | undefined, incoming: ReleaseType): ReleaseType {
  return !current || bumpStrength[incoming] > bumpStrength[current] ? incoming : current
}

function manifestPath(workspacePackage: WorkspacePackage): string {
  return `packages/${workspacePackage.directory}/package.json`
}
