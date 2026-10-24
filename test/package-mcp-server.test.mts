import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

const tsc = process.platform === 'win32' ? 'node_modules/.bin/tsc.cmd' : 'node_modules/.bin/tsc'
const caretSemverRange = /^\^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

type Manifest = {
  version: string
  dependencies?: Record<string, string>
  exports: Record<string, { import: string; types: string }>
  peerDependencies?: Record<string, string>
  files: string[]
}

describe('mcp-server package publication boundary', () => {
  beforeAll(() => {
    execFileSync(tsc, ['--project', 'packages/mcp-server/tsconfig.build.json'])
  })

  const manifest = JSON.parse(readFileSync('packages/mcp-server/package.json', 'utf8')) as Manifest

  it('publishes explicit subpaths only, with no root export', () => {
    expect(Object.keys(manifest.exports)).toEqual(['./types', './schema'])
    for (const entry of Object.values(manifest.exports)) {
      expect(existsSync(`packages/mcp-server/${entry.types.replace('./', '')}`)).toBe(true)
      importBuiltModule(`packages/mcp-server/${entry.import.replace('./', '')}`)
    }
    expect(manifest.files).toEqual(['dist', 'README.md', 'LICENSE'])
  })

  it('ships no test helpers or fixtures in the build', () => {
    expect(existsSync('packages/mcp-server/dist/test-helpers.mjs')).toBe(false)
  })

  it('declares caret ranges and is bootstrapped at 0.0.0', () => {
    expect(manifest.version).toMatch(/^0\.(0\.0|1\.\d+)$/u)
    for (const range of Object.values({ ...manifest.dependencies, ...manifest.peerDependencies }))
      expect(range).toMatch(caretSemverRange)
  })

  it('is selectable by the release workflow', () => {
    expect(readFileSync('.github/workflows/release.yml', 'utf8')).toContain(
      "'@vouchington/mcp-server'",
    )
  })
})

function importBuiltModule(file: string): void {
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(pathToFileURL(resolve(file)).href)})`,
    ],
    { stdio: 'pipe' },
  )
}
