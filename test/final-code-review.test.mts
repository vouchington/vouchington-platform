import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/final-code-review.yml', 'utf8')
const request = readFileSync('.github/workflows/request-final-review.yml', 'utf8')
const stop = readFileSync('.github/workflows/stop-final-review.yml', 'utf8')
const toolingPin = workflow.match(/select-final-review@([0-9a-f]{40})/u)?.[1]
if (toolingPin === undefined) throw new Error('Final review selector must use a full SHA pin')

describe('Final Code Review gate', () => {
  it('uses a correlated dispatch and one selected-head Code Reviewed check', () => {
    expect(existsSync('.github/workflows/ci-request-final-code-review.yml')).toBe(false)
    expect(workflow).toContain('name: Final Code Review')
    expect(workflow).toContain('repository_dispatch:')
    expect(workflow).toContain('types: [final-review-requested]')
    expect(workflow).toContain('name: Code Reviewed')
    expect(workflow).not.toContain("github.event.label.name == 'final-code-review:requested'")
    expect(workflow).toContain('checks: write')
    expect(workflow).not.toContain('CODE_REVIEW_TRIGGER_TOKEN')
    expect(workflow).not.toMatch(/TESTS_WAIT|WAIT_(ATTEMPTS|SECONDS)/)
  })

  it('routes and selects the exact tested CI head through pinned composites', () => {
    expect(request).toContain('workflow_run:')
    expect(request).toContain('source-run-attempt: ${{ github.event.workflow_run.run_attempt }}')
    expect(request).toContain(
      `vouchington/vouchington-tooling/.github/actions/request-final-review@${toolingPin}`,
    )
    expect(workflow).toContain(
      `vouchington/vouchington-tooling/.github/actions/select-final-review@${toolingPin}`,
    )
    expect(workflow).toContain('workflow-path: .github/workflows/ci.yml')
    expect(workflow).toContain('fan-in-job: test')
    expect(workflow).toContain('issues: write\n      pull-requests: write')
  })

  it('cancels provider work and clears state on draft or close', () => {
    expect(stop).toContain('types: [converted_to_draft, closed]')
    expect(stop).toContain(
      'final-code-review-${{ github.event.pull_request.number }}-${{ github.event.pull_request.head.sha }}',
    )
    expect(stop).toContain('cancel-in-progress: true')
    expect(stop).not.toMatch(/sleep|poll|WAIT_/i)
  })

  it('keeps provider and poster failures advisory behind the native gate', () => {
    expect(workflow.match(/continue-on-error: true/g)).toHaveLength(4)
    expect(workflow).toContain(
      `vouchington/vouchington-tooling/.github/actions/final-review-gate@${toolingPin}`,
    )
    expect(workflow).toContain("CLAUDE_ENABLED: 'false'")
    expect(workflow).toContain('if: always()')
    expect(workflow).toContain('COMPLETE_LABEL: final-code-review:complete')
  })

  it('runs OpenRouter and Zen in parallel with the pinned provider actions', () => {
    expect(workflow).toContain('opencode-code-review:')
    expect(workflow).toContain('opencode-zen-code-review:')
    expect(workflow).toContain(
      `vouchington/vouchington-tooling/.github/actions/opencode-code-review@${toolingPin}`,
    )
    expect(workflow).toContain(
      `vouchington/vouchington-tooling/.github/actions/code-review-poster@${toolingPin}`,
    )
    expect(workflow).toContain("needs.select-final-review.outputs.should_review == 'true'")
    expect(workflow).toContain('cancel-in-progress: true')
  })
})
