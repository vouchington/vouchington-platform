import { execFileSync } from 'node:child_process'

import type { StoredReleasePlan } from './release-plan.mts'

export function checkoutReleaseCommit(plan: StoredReleasePlan): void {
  const commits = new Set(plan.releases.map((release) => tagCommit(tagName(release))))
  if (commits.has(undefined)) throw new Error('Pending release plan has a missing tag')
  if (commits.size !== 1) throw new Error('Pending release tags do not share one commit')
  // Only packages/ needs to match the tagged release commit, for build reproducibility. Restoring it
  // (rather than detaching the whole tree to the release commit and clawing individual paths back) keeps
  // every other path -- scripts/, test/, vitest.config.mts, root configs -- at whatever the dispatched
  // commit looks like, so a resumed run picks up fixes to the release tooling itself instead of re-running
  // whatever was broken when the plan first got stuck.
  // --no-overlay: without it, a file added under packages/ on the dispatched commit after the release
  // was tagged (a new file in the same package, or an entirely new package) would survive the restore,
  // so the resumed run could pack/publish content the tagged commit never actually contained.
  execFileSync(
    'git',
    ['restore', '--source', [...commits][0]!, '--worktree', '--no-overlay', 'packages'],
    { stdio: 'inherit' },
  )
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
