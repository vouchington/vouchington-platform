import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')

describe('CI pull request events', () => {
  it('keeps the existing check runs when a draft pull request is marked ready', () => {
    expect(workflow).toContain('pull_request:\n    types: [opened, synchronize, reopened]\n')
    expect(workflow).not.toContain('ready_for_review')
    expect(workflow).not.toContain('converted_to_draft')
  })
})
