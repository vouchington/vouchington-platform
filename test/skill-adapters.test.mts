import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const checklistAdapter = readFileSync('.agents/skills/github-actions-checklist/SKILL.md', 'utf8')

describe('workflow skill adapters', () => {
  it('resolves the GitHub Actions checklist from the installed tooling package', () => {
    const target = checklistAdapter.match(
      /`(node_modules\/vouchington-tooling\/skills\/github-actions-checklist\/SKILL\.md)`/,
    )?.[1]

    expect(target).toBeDefined()
    expect(existsSync(target!)).toBe(true)
  })
})
