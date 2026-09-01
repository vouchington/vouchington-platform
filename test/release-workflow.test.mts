import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/release.yml', 'utf8')

describe('release workflow', () => {
  it('supports stable release types only', () => {
    expect(workflow).toContain('          - patch\n          - minor\n          - major')
    expect(workflow).not.toMatch(/- premajor|- preminor|- prepatch|- prerelease/u)
  })

  it('prepares and validates the post-bump workspace before external mutations', () => {
    const prepare = position('node scripts/release.mts prepare')
    const lockfile = position('pnpm install --lockfile-only')
    const typecheck = position('pnpm run typecheck')
    const build = position('pnpm run build')
    const lint = position('pnpm run lint')
    const tests = position('pnpm run test:coverage')
    const actionlint = position('pnpm run actionlint')
    const verify = position('node scripts/release.mts verify')
    const pack = position('node scripts/release.mts pack')
    const tag = position('node scripts/release.mts tag')
    const push = position('git push --atomic origin HEAD:main --follow-tags')
    const publish = position('node scripts/release.mts publish')
    const release = position('node scripts/release.mts github-release')

    expect(lockfile).toBeGreaterThan(prepare)
    for (const validation of [typecheck, build, lint, tests, actionlint, verify, pack]) {
      expect(validation).toBeGreaterThan(lockfile)
      expect(tag).toBeGreaterThan(validation)
    }
    expect(push).toBeGreaterThan(tag)
    expect(publish).toBeGreaterThan(push)
    expect(release).toBeGreaterThan(publish)
  })

  it('does not retain the single-package inline release implementation', () => {
    expect(workflow).not.toContain('pnpm --filter "$PACKAGE" version')
    expect(workflow).not.toContain(
      'working-directory: packages/${{ steps.bump.outputs.directory }}',
    )
  })

  it('persists release state and makes recovery operations idempotent', () => {
    expect(workflow).toContain('".github/release-plan.json"')
    expect(workflow).toContain(
      'git add packages/*/package.json pnpm-lock.yaml .github/release-plan.json',
    )
    expect(workflow).toContain('if ! git diff --cached --quiet; then')
  })

  it('uses pnpm to convert workspace protocols while packing and publishing', () => {
    expect(readFileSync('scripts/release.mts', 'utf8')).toContain(
      "runForEach(readPlan(expectArguments(arguments_, 1)[0]), 'pnpm', ['pack', '--dry-run'])",
    )
    expect(readFileSync('scripts/release-remote.mts', 'utf8')).toContain(
      "execFileSync('pnpm', ['publish', '--access', 'public', '--no-git-checks']",
    )
  })
})

function position(value: string): number {
  const index = workflow.indexOf(value)
  expect(index, `missing workflow fragment: ${value}`).toBeGreaterThanOrEqual(0)
  return index
}
