import { existsSync, readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const finalReview = readFileSync('.github/workflows/final-code-review.yml', 'utf8')
const request = readFileSync('.github/workflows/request-final-review.yml', 'utf8')
const cleanup = readFileSync('.github/workflows/clear-final-review-labels.yml', 'utf8')
const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

function expectPinnedAction(text: string, action: string) {
  const escaped = action.replaceAll('.', '\\.')
  expect(text).toMatch(
    new RegExp(`^\\s*(?:-\\s+)?uses: ${escaped}@[0-9a-f]{40} # v[0-9][^\\s]*$`, 'm'),
  )
}

describe('event-driven final code review', () => {
  it('routes each completed CI fan-in through one correlated dispatch', () => {
    expect(request).toContain('workflow_run:')
    expect(request).toContain('workflows: [CI]')
    expect(request).toContain('types: [completed]')
    expect(request).toContain("github.event.workflow_run.event == 'pull_request'")
    expect(request).toContain('source-run-id: ${{ github.event.workflow_run.id }}')
    expect(request).toContain('source-run-attempt: ${{ github.event.workflow_run.run_attempt }}')
    expect(request).toContain('source-workflow-path: .github/workflows/ci.yml')
    expect(request).toContain('fan-in-job: tests')
    expect(request).toContain('review-check-name: Code Reviewed')
    expectPinnedAction(
      request,
      'vouchington/vouchington-tooling/.github/actions/request-final-review',
    )
  })

  it('selects exactly the dispatched CI attempt and never waits for CI', () => {
    expect(finalReview).toContain('repository_dispatch:')
    expect(finalReview).toContain('types: [final-review-requested]')
    expect(finalReview).toContain('source-run-id: ${{ github.event.client_payload.source_run_id }}')
    expect(finalReview).toContain(
      'source-run-attempt: ${{ github.event.client_payload.source_run_attempt }}',
    )
    expect(finalReview).toContain('source-base-sha: ${{ github.event.client_payload.base_sha }}')
    expect(finalReview).toContain('workflow-path: .github/workflows/ci.yml')
    expect(finalReview).toContain('fan-in-job: tests')
    expect(finalReview).not.toMatch(/WAIT_(ATTEMPTS|SECONDS)|TESTS_WAIT|wait-for-tests/i)
    expectPinnedAction(
      finalReview,
      'vouchington/vouchington-tooling/.github/actions/select-final-review',
    )
    expect(existsSync('.github/actions/final-review-select/action.yml')).toBe(false)
  })

  it('keeps the selected-head synthetic Code Reviewed check', () => {
    expect(finalReview).toContain('name: >-\n      Code Reviewed')
    expect(finalReview).toContain('checks: write')
    expect(finalReview).toContain(
      'selected_head_sha: ${{ needs.select-final-review.outputs.head_sha }}',
    )
    expect(finalReview).toContain(
      'selected_base_sha: ${{ needs.select-final-review.outputs.base_sha }}',
    )
    expect(finalReview).toContain('check_name: Code Reviewed')
    expectPinnedAction(
      finalReview,
      'vouchington/vouchington-tooling/.github/actions/final-review-gate',
    )
  })

  it('keeps exact selected-head and trusted-base refs', () => {
    expect(finalReview).toContain('ref: ${{ needs.select-final-review.outputs.head_sha }}')
    expect(finalReview).toContain(
      'trusted_prompt_ref: ${{ needs.select-final-review.outputs.base_sha }}',
    )
    expect(finalReview).toContain(
      'expected_base_sha: ${{ needs.select-final-review.outputs.base_sha }}',
    )
    expect(finalReview).toContain('persist-credentials: false')
  })

  it('cancels and clears state only from base-owned lifecycle orchestration', () => {
    expect(cleanup).toContain('pull_request_target:')
    expect(cleanup).toContain('types: [converted_to_draft, closed]')
    expect(cleanup).toContain('github.event.pull_request.base.repo.full_name == github.repository')
    expect(cleanup).toContain('cancel-in-progress: true')
    expect(cleanup).toContain('final-code-review:requested')
    expect(cleanup).toContain('final-code-review:complete')
    expect(cleanup).not.toMatch(/sleep|poll|WAIT_/i)
    expect(cleanup).not.toContain('actions/checkout')
  })

  it('keeps a bounded CI fan-in for the router', () => {
    expect(ci).toContain('tests:')
    expect(ci).toContain('name: tests')
    expect(ci).toContain('needs: [test, actionlint]')
    expect(ci).toContain('timeout-minutes: 2')
  })

  it('pins every repository action by identity, SHA shape, and version comment', () => {
    for (const file of readdirSync('.github/workflows')) {
      const workflow = readFileSync(`.github/workflows/${file}`, 'utf8')
      for (const line of workflow.split('\n').filter((candidate) => candidate.includes('uses:'))) {
        if (line.includes('uses: ./')) continue
        expect(line).toMatch(/uses: [^@\s]+@[0-9a-f]{40} # v[0-9][^\s]*$/)
      }
    }
  })

  it('bounds every concrete job and keeps public PR-target workflows base-owned', () => {
    for (const text of [finalReview, request, cleanup, ci]) {
      for (const job of text.split(/^  [a-z][\w-]*:\n/m).slice(1)) {
        if (!job.includes('runs-on:')) continue
        expect(job).toMatch(/timeout-minutes: (?:[1-9]|[12][0-9]|30)\b/)
      }
    }
    expect(finalReview).not.toContain('pull_request_target')
    expect(request).not.toContain('pull_request_target')
  })
})
