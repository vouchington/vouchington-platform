import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const machineContract =
  'https://github.com/vouchington/vouchington-machines/blob/main/docs/agent-config.md'

const repoRegistrations = [
  '.mcp.json',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.codex/config.toml',
  '.cursor/mcp.json',
]

const trackedFiles = (...pathspecs: string[]) =>
  execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)

describe('Agent Blackboard host configuration', () => {
  it('tracks no repository-level MCP registration or host settings', () => {
    expect(trackedFiles(...repoRegistrations)).toEqual([])
    expect(trackedFiles('.claude', '.codex').toSorted()).toEqual([
      '.claude/README.md',
      '.codex/README.md',
    ])
  })

  it('ignores the removed host configuration paths', () => {
    const ignored = execFileSync(
      'git',
      ['check-ignore', '--no-index', '--', '.claude/settings.json', '.codex/config.toml'],
      { encoding: 'utf8' },
    )
    expect(ignored.split('\n').filter(Boolean)).toEqual([
      '.claude/settings.json',
      '.codex/config.toml',
    ])
  })

  it('declares no blackboard server, plugin, marketplace, or tool grant', () => {
    const files = trackedFiles(
      ':(glob)*',
      ':(glob).*',
      '.claude',
      '.codex',
      '.github',
      ':(exclude)test/agent-blackboard-config.test.mts',
    ).filter((path) => !path.endsWith('pnpm-lock.yaml'))
    expect(files).toContain('AGENTS.md')
    for (const path of files) {
      const contents = readFileSync(path, 'utf8')
      for (const pattern of [
        /agent-blackboard@/u,
        /enabledMcpjsonServers/u,
        /mcp__agent[-_]blackboard__/u,
        /mcp__vouchington[-_]tooling__/u,
        /plugin marketplace add/u,
        /\[plugins\./u,
        /"mcpServers"/u,
      ]) {
        expect({ path, match: pattern.test(contents) }).toEqual({ path, match: false })
      }
    }
  })

  it('defers host configuration to the machine ownership contract', () => {
    for (const path of ['.claude/README.md', '.codex/README.md']) {
      const instructions = readFileSync(path, 'utf8')
      expect(instructions).toContain(machineContract)
      expect(instructions).toMatch(/machine-registered `vouchington-tooling` MCP server/u)
    }
  })

  it('requires fail-closed, explicit session journaling in root instructions', () => {
    const instructions = readFileSync('AGENTS.md', 'utf8')
    expect(instructions).toMatch(/machine-registered `vouchington-tooling` MCP server/u)
    expect(instructions).toMatch(/`vouchington-workflow:blackboard`/u)
    expect(instructions).not.toMatch(/upstream `agent-blackboard` plugin/u)
    expect(instructions).toMatch(/Session ids.*must\s+be\s+explicit/isu)
    expect(instructions).toMatch(/fail closed/iu)
  })
})
