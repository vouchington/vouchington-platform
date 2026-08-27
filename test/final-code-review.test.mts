import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/final-code-review.yml', 'utf8')
const router = readFileSync('.github/workflows/ci-request-final-code-review.yml', 'utf8')

describe('Final Code Review gate', () => {
  it('uses one native Code Reviewed job for every PR-head update', () => {
    expect(workflow).toContain('name: Final Code Review')
    expect(workflow).toContain('pull_request_target:')
    expect(workflow).toContain('types: [labeled, ready_for_review]')
    expect(workflow).toContain("&& 'Code Reviewed' || 'Ignore final review request'")
    expect(workflow).toContain("github.event.label.name == 'final-code-review:requested'")
    expect(workflow).not.toContain('checks: write')
    expect(workflow).not.toContain('--method POST "repos/$REPOSITORY/check-runs"')
  })

  it('requires provenance from the exact pull-request CI run', () => {
    expect(workflow).toContain('repos/$REPOSITORY/commits/$HEAD_SHA/check-runs?per_page=100')
    expect(workflow).toContain('any(.pull_requests[]?; .number == $pr)')
    expect(workflow).toContain('.path == ".github/workflows/ci.yml"')
    expect(workflow).toContain('for check_name in test actionlint; do')
  })

  it('keeps provider and poster failures advisory behind the native gate', () => {
    expect(workflow.match(/continue-on-error: true/g)).toHaveLength(4)
    expect(workflow).toContain('provider outcomes are advisory')
    expect(workflow).toContain('if: always()')
    expect(workflow).toContain('Refusing to pass a stale Final Code Review gate')
  })

  it('runs providers in parallel and keeps each PR head in its own concurrency group', () => {
    expect(workflow).toContain('opencode-openrouter-review:')
    expect(workflow).toContain('opencode-zen-review:')
    expect(workflow).toContain('needs: [await-required-tests, validate-review-settings]')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(router).toContain('.name == "test"')
    expect(router).toContain('.name == "actionlint"')
    expect(router).toContain('sort_by(.run_attempt, .id)')
    expect(router).toContain('commits/$TESTED_HEAD_SHA/pulls')
    expect(router).toContain('.head.repo.full_name == $head_repo')
    expect(router).toContain('.path == ".github/workflows/final-code-review.yml"')
  })

  it('uses the read token for lookups and the trigger token only for label mutations', () => {
    expect(router).toContain('GH_TOKEN: ${{ github.token }}')
    expect(router).toContain('CODE_REVIEW_TRIGGER_TOKEN: ${{ secrets.CODE_REVIEW_TRIGGER_TOKEN }}')
    expect(router).toContain('gh_label_retry()')
    expect(router).toContain('GH_TOKEN="$CODE_REVIEW_TRIGGER_TOKEN" gh_retry')
    expect(router).not.toContain('GH_TOKEN: ${{ secrets.CODE_REVIEW_TRIGGER_TOKEN }}')
    expect(router).toContain(
      'actions: read\n      checks: read\n      contents: read\n      pull-requests: read',
    )
    expect(router).toContain('github.token is required for router reads')
    expect(router).toContain('CODE_REVIEW_TRIGGER_TOKEN is required')

    const reads = router.match(/\bgh_retry (?:none|404) gh api/g) ?? []
    const mutations =
      router.match(/gh_label_retry (?:none|404) gh api --method (?:DELETE|POST)/g) ?? []
    expect(reads.length).toBeGreaterThan(0)
    expect(mutations).toHaveLength(4)
  })
})
