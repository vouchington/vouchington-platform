import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const tools = [
  'entry_append',
  'entry_get',
  'session_archive',
  'session_create',
  'session_ensure',
  'session_patch',
  'session_search',
  'snapshot_export',
].map((name) => `mcp__agent-blackboard__${name}`)

describe('Agent Blackboard host configuration', () => {
  it('keeps Claude MCP registration pinned and environment-only', () => {
    expect(JSON.parse(readFileSync('.mcp.json', 'utf8'))).toEqual({
      mcpServers: {
        'agent-blackboard': {
          command: 'npx',
          args: ['-y', 'agent-blackboard@0.5.0', 'mcp'],
          env: {
            AGENT_BLACKBOARD_URL: '${AGENT_BLACKBOARD_URL}',
            AGENT_BLACKBOARD_TOKEN: '${AGENT_BLACKBOARD_TOKEN}',
          },
        },
      },
    })
  })

  it('pre-authorizes exactly the current eight MCP tools', () => {
    const settings = JSON.parse(readFileSync('.claude/settings.json', 'utf8'))
    expect(settings.enabledMcpjsonServers).toEqual(['agent-blackboard'])
    expect(settings.permissions.allow).toEqual(tools)
    expect(settings.permissions.allow.some((tool: string) => tool.includes('*'))).toBe(false)
  })

  it('documents the upstream Codex plugin registration', () => {
    const instructions = readFileSync('.codex/README.md', 'utf8')
    expect(instructions).toMatch(/codex plugin marketplace add jonathanong\/agent-blackboard/u)
    expect(instructions).toMatch(/codex plugin add agent-blackboard@agent-blackboard/u)
    expect(instructions).toMatch(/agent-blackboard@0\.5\.0/u)
    const config = readFileSync('.codex/config.toml', 'utf8')
    expect(config).toMatch(/\[plugins\."agent-blackboard@agent-blackboard"\]\nenabled = true/u)
    const approvals = [...config.matchAll(/\.tools\.([a-z_]+)\]\napproval_mode = "approve"/gu)].map(
      (match) => match[1],
    )
    expect(config.match(/approval_mode = "approve"/gu)).toHaveLength(8)
    expect(approvals).toEqual([
      'entry_append',
      'entry_get',
      'session_archive',
      'session_create',
      'session_ensure',
      'session_patch',
      'session_search',
      'snapshot_export',
    ])
  })

  it('requires fail-closed, explicit session journaling in root instructions', () => {
    const instructions = readFileSync('AGENTS.md', 'utf8')
    expect(instructions).toMatch(/upstream `agent-blackboard` plugin/u)
    expect(instructions).toMatch(/`vouchington-workflow:blackboard`/u)
    expect(instructions).toMatch(/Session ids.*must\s+be\s+explicit/isu)
    expect(instructions).toMatch(/fail closed/iu)
  })
})
