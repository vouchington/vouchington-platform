import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import semver from 'semver'

import {
  planWorkspaceRelease,
  releaseTypes,
  type ReleaseType,
  type StoredReleasePlan,
} from './release-plan.mts'
import {
  createMissingGitHubReleases,
  publishMissing,
  remoteReleaseComplete,
} from './release-remote.mts'
import {
  loadWorkspacePackages,
  publishedRange,
  type PackageManifest,
} from './release-workspace.mts'

const [command, ...arguments_] = process.argv.slice(2)
switch (command) {
  case 'prepare':
    prepare(...expectArguments(arguments_, 4))
    break
  case 'verify':
    verify(readPlan(expectArguments(arguments_, 1)[0]))
    break
  case 'pack':
    runForEach(readPlan(expectArguments(arguments_, 1)[0]), 'npm', ['pack', '--dry-run'])
    break
  case 'tag':
    tag(readPlan(expectArguments(arguments_, 1)[0]))
    break
  case 'publish':
    publishMissing(readPlan(expectArguments(arguments_, 1)[0]))
    break
  case 'github-release':
    createMissingGitHubReleases(readPlan(expectArguments(arguments_, 1)[0]))
    break
  case 'selected-version':
    selectedVersion(readPlan(expectArguments(arguments_, 1)[0]))
    break
  case 'selected-package':
    process.stdout.write(readPlan(expectArguments(arguments_, 1)[0]).selectedPackage)
    break
  case 'summary':
    summary(readPlan(expectArguments(arguments_, 1)[0]))
    break
  default:
    throw new Error(`Unknown release command: ${command ?? ''}`)
}

function prepare(
  selectedPackage: string,
  releaseTypeValue: string,
  planPath: string,
  persistedPath: string,
): void {
  if (!releaseTypes.includes(releaseTypeValue as ReleaseType))
    throw new Error(`Unsupported release type: ${releaseTypeValue}`)
  if (existsSync(persistedPath)) {
    const persisted = readPlan(persistedPath)
    if (!remoteReleaseComplete(persisted)) {
      assertPlanMatchesWorkspace(persisted)
      writeJson(resolve(planPath), persisted)
      return
    }
  }
  const plan = planWorkspaceRelease(
    loadWorkspacePackages(process.cwd()),
    selectedPackage,
    releaseTypeValue as ReleaseType,
  )
  const changed = new Set(plan.changedManifests)
  for (const workspacePackage of plan.packages) {
    const path = `packages/${workspacePackage.directory}/package.json`
    if (changed.has(path)) writeJson(path, workspacePackage.manifest)
  }
  const stored: StoredReleasePlan = {
    changedManifests: plan.changedManifests,
    releases: plan.releases,
    selectedPackage: plan.selectedPackage,
  }
  writeJson(resolve(planPath), stored)
  writeJson(resolve(persistedPath), stored)
}

function verify(plan: StoredReleasePlan): void {
  const positions = new Map(plan.releases.map(({ name }, index) => [name, index]))
  const versions = new Map(plan.releases.map(({ name, toVersion }) => [name, toVersion]))
  const workspaceVersions = new Map(
    loadWorkspacePackages(process.cwd()).map(({ manifest }) => [manifest.name, manifest.version]),
  )
  for (const [index, release] of plan.releases.entries()) {
    const manifest = readManifest(release.directory)
    const runtimeDependencies = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    }
    for (const [name, sourceRange] of Object.entries(runtimeDependencies)) {
      if (!name.startsWith('@vouchington/')) continue
      const range = publishedRange(sourceRange, workspaceVersions.get(name))
      const plannedVersion = versions.get(name)
      if (!plannedVersion) {
        execFileSync('npm', ['view', `${name}@${range}`, 'version'], { stdio: 'inherit' })
        continue
      }
      if (!semver.satisfies(plannedVersion, range))
        throw new Error(`${release.name} ${sourceRange} excludes planned ${name}@${plannedVersion}`)
      if (positions.get(name)! >= index)
        throw new Error(`${release.name} is ordered before planned dependency ${name}`)
    }
  }
}

function tag(plan: StoredReleasePlan): void {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  for (const release of plan.releases) {
    const name = `${release.directory}-v${release.toVersion}`
    const existing = tagCommit(name)
    if (existing === head) continue
    if (existing) throw new Error(`Tag ${name} points to ${existing}, not ${head}`)
    execFileSync('git', ['tag', '-a', name, '-m', `${release.name} v${release.toVersion}`], {
      stdio: 'inherit',
    })
  }
}

function runForEach(plan: StoredReleasePlan, executable: string, arguments_: string[]): void {
  for (const release of plan.releases)
    execFileSync(executable, arguments_, {
      cwd: `packages/${release.directory}`,
      stdio: 'inherit',
    })
}

function selectedVersion(plan: StoredReleasePlan): void {
  const selected = plan.releases.find(({ name }) => name === plan.selectedPackage)
  if (!selected)
    throw new Error(`Selected package missing from release plan: ${plan.selectedPackage}`)
  process.stdout.write(selected.toVersion)
}

function summary(plan: StoredReleasePlan): void {
  process.stdout.write(
    `Release order:\n${plan.releases.map(({ name, toVersion }) => `- ${name} v${toVersion}`).join('\n')}`,
  )
}

function readPlan(path: string): StoredReleasePlan {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as StoredReleasePlan
}

function assertPlanMatchesWorkspace(plan: StoredReleasePlan): void {
  const versions = new Map(
    loadWorkspacePackages(process.cwd()).map(({ manifest }) => [manifest.name, manifest.version]),
  )
  for (const release of plan.releases)
    if (versions.get(release.name) !== release.toVersion)
      throw new Error(`Pending release plan does not match ${release.name}@${release.toVersion}`)
}

function tagCommit(name: string): string | undefined {
  try {
    return execFileSync('git', ['rev-list', '-n', '1', name], { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

function readManifest(directory: string): PackageManifest {
  return JSON.parse(readFileSync(`packages/${directory}/package.json`, 'utf8')) as PackageManifest
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`)
}

function expectArguments(values: string[], count: 1): [string]
function expectArguments(values: string[], count: 4): [string, string, string, string]
function expectArguments(values: string[], count: number): string[] {
  if (values.length !== count)
    throw new Error(`Expected ${count} arguments, received ${values.length}`)
  return values
}
