import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import semver from 'semver'

import {
  planWorkspaceRelease,
  releaseTypes,
  type PlannedRelease,
  type ReleaseType,
} from './release-plan.mts'
import {
  loadWorkspacePackages,
  publishedRange,
  type PackageManifest,
} from './release-workspace.mts'

interface StoredReleasePlan {
  changedManifests: string[]
  releases: PlannedRelease[]
  selectedPackage: string
}

const [command, ...arguments_] = process.argv.slice(2)
switch (command) {
  case 'prepare':
    prepare(...expectArguments(arguments_, 3))
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
    runForEach(readPlan(expectArguments(arguments_, 1)[0]), 'npm', [
      'publish',
      '--access',
      'public',
    ])
    break
  case 'github-release':
    createGitHubReleases(readPlan(expectArguments(arguments_, 1)[0]))
    break
  case 'selected-version':
    selectedVersion(readPlan(expectArguments(arguments_, 1)[0]))
    break
  case 'summary':
    summary(readPlan(expectArguments(arguments_, 1)[0]))
    break
  default:
    throw new Error(`Unknown release command: ${command ?? ''}`)
}

function prepare(selectedPackage: string, releaseTypeValue: string, planPath: string): void {
  if (!releaseTypes.includes(releaseTypeValue as ReleaseType))
    throw new Error(`Unsupported release type: ${releaseTypeValue}`)
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
  for (const release of plan.releases)
    execFileSync(
      'git',
      [
        'tag',
        '-a',
        `${release.directory}-v${release.toVersion}`,
        '-m',
        `${release.name} v${release.toVersion}`,
      ],
      { stdio: 'inherit' },
    )
}

function runForEach(plan: StoredReleasePlan, executable: string, arguments_: string[]): void {
  for (const release of plan.releases)
    execFileSync(executable, arguments_, {
      cwd: `packages/${release.directory}`,
      stdio: 'inherit',
    })
}

function createGitHubReleases(plan: StoredReleasePlan): void {
  for (const release of plan.releases)
    execFileSync(
      'gh',
      [
        'release',
        'create',
        `${release.directory}-v${release.toVersion}`,
        '--title',
        `${release.name} v${release.toVersion}`,
        '--generate-notes',
      ],
      { stdio: 'inherit' },
    )
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

function readManifest(directory: string): PackageManifest {
  return JSON.parse(readFileSync(`packages/${directory}/package.json`, 'utf8')) as PackageManifest
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`)
}

function expectArguments(values: string[], count: 1): [string]
function expectArguments(values: string[], count: 3): [string, string, string]
function expectArguments(values: string[], count: number): string[] {
  if (values.length !== count)
    throw new Error(`Expected ${count} arguments, received ${values.length}`)
  return values
}
