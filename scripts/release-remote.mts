import { execFileSync } from 'node:child_process'

import type { StoredReleasePlan } from './release-plan.mts'

export function remoteReleaseComplete(plan: StoredReleasePlan): boolean {
  return plan.releases.every(
    (release) => versionExists(release.name, release.toVersion) && githubReleaseExists(release),
  )
}

export function publishMissing(plan: StoredReleasePlan): void {
  for (const release of plan.releases) {
    if (versionExists(release.name, release.toVersion)) continue
    execFileSync('npm', ['publish', '--access', 'public'], {
      cwd: `packages/${release.directory}`,
      stdio: 'inherit',
    })
  }
}

export function createMissingGitHubReleases(plan: StoredReleasePlan): void {
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
  return succeeds('npm', ['view', `${name}@${version}`, 'version'])
}

function githubReleaseExists(release: StoredReleasePlan['releases'][number]): boolean {
  return succeeds('gh', ['release', 'view', tagName(release)])
}

function tagName(release: StoredReleasePlan['releases'][number]): string {
  return `${release.directory}-v${release.toVersion}`
}

function succeeds(executable: string, arguments_: string[]): boolean {
  try {
    execFileSync(executable, arguments_, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
