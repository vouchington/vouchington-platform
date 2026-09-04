import { execFileSync } from 'node:child_process'

import type { StoredReleasePlan } from './release-plan.mts'

export function remoteReleaseComplete(plan: StoredReleasePlan): boolean {
  assertGitHubRepositoryAccessible()
  return plan.releases.every(
    (release) => versionExists(release.name, release.toVersion) && githubReleaseExists(release),
  )
}

const ALREADY_PUBLISHED_PATTERN = /cannot publish over the previously published versions/iu

export function publishMissing(plan: StoredReleasePlan): void {
  for (const release of plan.releases) {
    if (versionExists(release.name, release.toVersion)) continue
    try {
      execFileSync('pnpm', ['publish', '--access', 'public', '--no-git-checks'], {
        cwd: `packages/${release.directory}`,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      const output = commandOutput(error)
      if (!ALREADY_PUBLISHED_PATTERN.test(output)) {
        console.error(output)
        throw error
      }
      console.log(
        `${release.name}@${release.toVersion} is already published on npm; treating as complete.`,
      )
    }
  }
}

export function createMissingGitHubReleases(plan: StoredReleasePlan): void {
  assertGitHubRepositoryAccessible()
  for (const release of plan.releases) {
    if (githubReleaseExists(release)) continue
    execFileSync(
      'gh',
      [
        'release',
        'create',
        tagName(release),
        '--title',
        `${release.name} v${release.toVersion}`,
        '--generate-notes',
      ],
      { stdio: 'inherit' },
    )
  }
}

function versionExists(name: string, version: string): boolean {
  return artifactExists('npm', ['view', `${name}@${version}`, 'version', '--json'], /\bE404\b/u)
}

function githubReleaseExists(release: StoredReleasePlan['releases'][number]): boolean {
  return artifactExists(
    'gh',
    [
      'api',
      `repos/{owner}/{repo}/releases/tags/${encodeURIComponent(tagName(release))}`,
      '--silent',
    ],
    /\(HTTP 404\)/u,
  )
}

function assertGitHubRepositoryAccessible(): void {
  execFileSync('gh', ['api', 'repos/{owner}/{repo}', '--silent'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function tagName(release: StoredReleasePlan['releases'][number]): string {
  return `${release.directory}-v${release.toVersion}`
}

function artifactExists(executable: string, arguments_: string[], missingPattern: RegExp): boolean {
  try {
    execFileSync(executable, arguments_, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return true
  } catch (error) {
    if (missingPattern.test(commandOutput(error))) return false
    throw error
  }
}

function commandOutput(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const { stderr, stdout } = error as { stderr?: unknown; stdout?: unknown }
  return [stdout, stderr].filter((value): value is string => typeof value === 'string').join('\n')
}
