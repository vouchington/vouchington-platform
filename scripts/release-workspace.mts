import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import semver from 'semver'

export type DependencyField =
  | 'dependencies'
  | 'devDependencies'
  | 'optionalDependencies'
  | 'peerDependencies'

export interface PackageManifest {
  name: string
  version: string
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  [key: string]: unknown
}

export interface WorkspacePackage {
  directory: string
  manifest: PackageManifest
}

export const dependencyFields: DependencyField[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]
export const publishedFields = new Set<DependencyField>([
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
])

export function loadWorkspacePackages(root: string): WorkspacePackage[] {
  const packagesDirectory = join(root, 'packages')
  const entries = readdirSync(packagesDirectory, { withFileTypes: true })
  const packages: WorkspacePackage[] = []
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const manifestPath = join(packagesDirectory, entry.name, 'package.json')
    if (!entry.isDirectory() || !existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
    packages.push({ directory: entry.name, manifest })
  }
  return packages
}

export function indexAndValidate(packages: WorkspacePackage[]): Map<string, WorkspacePackage> {
  const byName = new Map<string, WorkspacePackage>()
  for (const workspacePackage of packages) {
    const { name, version } = workspacePackage.manifest
    if (!name || byName.has(name))
      throw new Error(`Duplicate or missing workspace package name: ${name}`)
    if (!semver.valid(version)) throw new Error(`Invalid version for ${name}: ${version}`)
    byName.set(name, workspacePackage)
  }
  for (const workspacePackage of packages)
    for (const field of dependencyFields)
      for (const [dependency, range] of Object.entries(workspacePackage.manifest[field] ?? {}))
        if (byName.has(dependency))
          parseRange(
            range,
            workspacePackage.manifest.name,
            dependency,
            byName.get(dependency)!.manifest.version,
          )
  assertAcyclic(packages, byName)
  return byName
}

export function rangeIncludes(
  range: string,
  target: string,
  dependencyVersion: string | undefined,
): boolean {
  return semver.satisfies(target, parseRange(range, 'package', 'dependency', dependencyVersion))
}

export function publishedRange(range: string, dependencyVersion: string | undefined): string {
  return parseRange(range, 'package', 'dependency', dependencyVersion)
}

export function normalizedRange(range: string, target: string): string {
  if (['workspace:*', 'workspace:^', 'workspace:~'].includes(range)) return range
  return `${range.startsWith('workspace:') ? 'workspace:' : ''}^${target}`
}

export function topologicalOrder(
  names: Iterable<string>,
  byName: Map<string, WorkspacePackage>,
): string[] {
  const planned = new Set(names)
  const ordered: string[] = []
  const visited = new Set<string>()
  const visit = (name: string): void => {
    if (visited.has(name)) return
    visited.add(name)
    const manifest = byName.get(name)!.manifest
    const dependencies = dependencyFields.flatMap((field) => Object.keys(manifest[field] ?? {}))
    for (const dependency of dependencies.toSorted()) if (planned.has(dependency)) visit(dependency)
    ordered.push(name)
  }
  for (const name of [...planned].toSorted()) visit(name)
  return ordered
}

function parseRange(
  range: string,
  owner = 'package',
  dependency = 'dependency',
  dependencyVersion?: string,
): string {
  const value = range.startsWith('workspace:') ? range.slice('workspace:'.length) : range
  if (range.startsWith('workspace:') && ['*', '^', '~'].includes(value)) {
    if (!dependencyVersion)
      throw new Error(`Missing version for workspace dependency ${dependency}`)
    return value === '*' ? dependencyVersion : `${value}${dependencyVersion}`
  }
  if (!value || value.includes(':') || semver.validRange(value) === null)
    throw new Error(`Unsupported workspace dependency range ${owner} -> ${dependency}: ${range}`)
  return value
}

function assertAcyclic(packages: WorkspacePackage[], byName: Map<string, WorkspacePackage>): void {
  const active = new Set<string>()
  const visited = new Set<string>()
  const visit = (name: string): void => {
    if (active.has(name)) throw new Error(`Workspace dependency cycle includes ${name}`)
    if (visited.has(name)) return
    active.add(name)
    const manifest = byName.get(name)!.manifest
    for (const field of dependencyFields)
      for (const dependency of Object.keys(manifest[field] ?? {}))
        if (byName.has(dependency)) visit(dependency)
    active.delete(name)
    visited.add(name)
  }
  for (const { manifest } of packages) visit(manifest.name)
}
