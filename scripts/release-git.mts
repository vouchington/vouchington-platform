import { execFileSync } from 'node:child_process'

import type { StoredReleasePlan } from './release-plan.mts'

export function checkoutReleaseCommit(plan: StoredReleasePlan): void {
  const commits = new Set(plan.releases.map((release) => tagCommit(tagName(release))))
  if (commits.has(undefined)) throw new Error('Pending release plan has a missing tag')
  if (commits.size !== 1) throw new Error('Pending release tags do not share one commit')
  execFileSync('git', ['checkout', '--detach', [...commits][0]!], { stdio: 'inherit' })
}

export function tagPlan(plan: StoredReleasePlan): void {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  for (const release of plan.releases) {
    const name = tagName(release)
    const existing = tagCommit(name)
    if (existing === head) continue
    if (existing) throw new Error(`Tag ${name} points to ${existing}, not ${head}`)
    execFileSync('git', ['tag', '-a', name, '-m', `${release.name} v${release.toVersion}`], {
      stdio: 'inherit',
    })
  }
}

function tagCommit(name: string): string | undefined {
  try {
    return execFileSync('git', ['rev-list', '-n', '1', name], { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

function tagName(release: StoredReleasePlan['releases'][number]): string {
  return `${release.directory}-v${release.toVersion}`
}
