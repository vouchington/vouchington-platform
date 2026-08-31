import { execFileSync } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const tsc = process.platform === 'win32' ? 'node_modules/.bin/tsc.cmd' : 'node_modules/.bin/tsc'

describe('auth package publication boundary', () => {
  beforeAll(() => {
    for (const project of ['uuid-v7', 'session-jwt', 'auth'])
      execFileSync(tsc, ['--project', `packages/${project}/tsconfig.build.json`])
  })

  it('publishes the framework-neutral root and explicit API-server adapter', () => {
    const manifest = JSON.parse(readFileSync('packages/auth/package.json', 'utf8')) as {
      dependencies: Record<string, string>
      exports: Record<string, { import: string; types: string }>
      peerDependencies: Record<string, string>
    }
    expect(Object.keys(manifest.exports)).toEqual(['.', './api-server'])
    expect(Object.keys(manifest.dependencies)).toEqual([
      '@simplewebauthn/server',
      '@vouchington/session-jwt',
      'otpauth',
    ])
    expect(Object.keys(manifest.peerDependencies)).toEqual(['@jongleberry/api-server'])
    for (const entry of Object.values(manifest.exports)) {
      importBuiltModule(`packages/auth/${entry.import.replace('./', '')}`)
      expect(readFileSync(`packages/auth/${entry.types.replace('./', '')}`, 'utf8')).not.toBe('')
    }
  })

  it('contains no application-owned identifiers or infrastructure imports', () => {
    const source = globSync('packages/auth/src/*.mts')
      .filter((file) => !file.endsWith('.test.mts'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
    expect(source).not.toMatch(
      /Voucha|Greesy|user_passkeys|user_totp_authenticators|\/api\/v1|process\.env|@services\/|@data-stores\/|bluesky|atproto|activitypub/i,
    )
  })

  it('is selectable by the release workflow', () => {
    expect(readFileSync('.github/workflows/release.yml', 'utf8')).toContain("'@vouchington/auth'")
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
