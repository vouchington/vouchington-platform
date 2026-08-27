import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/final-code-review.yml', 'utf8')

describe('Final Code Review gate', () => {
  it('uses one native Code Reviewed job for every PR-head update', () => {
    expect(workflow).toContain('name: Final Code Review')
    expect(workflow).toContain('pull_request_target:')
    expect(workflow).toContain('types: [opened, reopened, synchronize, ready_for_review, labeled]')
    expect(workflow).toContain('name: Code Reviewed')
    expect(workflow).not.toContain('check-runs')
  })

  it('requires provenance from the exact pull-request CI run', () => {
    expect(workflow).toContain(
      'actions/workflows/ci.yml/runs?head_sha=$head_sha&event=pull_request',
    )
    expect(workflow).toContain('select(any(.pull_requests[]?; .number == $pr))')
    expect(workflow).toContain('[ "$(jq -r \'.path\' <<<"$run")" = .github/workflows/ci.yml ]')
    expect(workflow).toContain('select(.name == "test")')
    expect(workflow).toContain('select(.name == "actionlint")')
  })

  it('keeps providers advisory and hardens label completion against stale heads', () => {
    expect(workflow).toContain('continue-on-error: true')
    expect(workflow).toContain('this is advisory')
    expect(workflow).toContain('selected_head ||')
    expect(workflow).toContain('PR head changed while marking final review complete')
    expect(workflow).toContain('PR head changed while finishing final review labels')
  })
})
