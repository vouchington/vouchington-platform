import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const TOOLING_PIN = 'f5f41caba5aef0b31e507a67123c76f1c9a53d02'
const OPENCODE_PIN = '1bcaf04b0ee3bf816c406d0239e7d7c54e44eb3f'
const workflow = readFileSync('.github/workflows/final-code-review.yml', 'utf8')

describe('Final Code Review gate', () => {
  it('uses a trusted default-branch PR trigger and one native Code Reviewed job', () => {
    expect(existsSync('.github/workflows/ci-request-final-code-review.yml')).toBe(false)
    expect(workflow).toContain('name: Final Code Review')
    expect(workflow).toContain('pull_request_target:')
    expect(workflow).toContain(
      'types: [opened, reopened, synchronize, ready_for_review, converted_to_draft, closed]',
    )
    expect(workflow).toContain("'Code Reviewed' || 'Ignore ineligible final review'")
    expect(workflow).not.toContain("github.event.label.name == 'final-code-review:requested'")
    expect(workflow).not.toContain('checks: write')
    expect(workflow).not.toContain('CODE_REVIEW_TRIGGER_TOKEN')
    expect(workflow).not.toContain('check-runs')
  })

  it('selects the exact tested CI head through the pinned composite', () => {
    expect(workflow).toContain(
      `vouchington/vouchington-tooling/.github/actions/final-review-select@${TOOLING_PIN}`,
    )
    expect(workflow).toContain('CI_WORKFLOW: ci.yml')
    expect(workflow).toContain('TESTS_JOB_NAME: test')
    expect(workflow).toContain('GH_TOKEN: ${{ github.token }}')
    expect(workflow).toContain('issues: write\n      pull-requests: write')
  })

  it('keeps provider and poster failures advisory behind the native gate', () => {
    expect(workflow.match(/continue-on-error: true/g)).toHaveLength(4)
    expect(workflow).toContain(
      `vouchington/vouchington-tooling/.github/actions/final-review-gate@${TOOLING_PIN}`,
    )
    expect(workflow).toContain("CLAUDE_ENABLED: 'false'")
    expect(workflow).toContain('if: always()')
    expect(workflow).toContain('COMPLETE_LABEL: final-code-review:complete')
  })

  it('runs OpenRouter and Zen in parallel with the pinned provider actions', () => {
    expect(workflow).toContain('opencode-code-review:')
    expect(workflow).toContain('opencode-zen-code-review:')
    expect(workflow).toContain(
      `vouchington/vouchington-tooling/.github/actions/opencode-code-review@${OPENCODE_PIN}`,
    )
    expect(workflow).toContain(
      `vouchington/vouchington-tooling/.github/actions/code-review-poster@${OPENCODE_PIN}`,
    )
    expect(workflow).toContain("needs.select-final-review.outputs.should_review == 'true'")
    expect(workflow).toContain('cancel-in-progress: true')
  })
})
