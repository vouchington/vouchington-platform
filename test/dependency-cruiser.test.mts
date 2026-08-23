import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import { beforeAll, describe, expect, it } from 'vitest'

const cruise = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const fixture = 'test/fixtures/dependency-cruiser'

describe('utils dependency boundary', () => {
  beforeAll(() => {
    execFileSync(cruise, ['run', 'build'], { encoding: 'utf8' })
  })

  it('publishes every explicit subpath and no root export', async () => {
    for (const entry of [
      'token-secrets',
      'deploy-environment',
      'url-signing',
      'request-client-info',
      'money',
      'env-contract',
      'cookies',
    ]) {
      expect(existsSync(`packages/utils/dist/${entry}.mjs`)).toBe(true)
      expect(existsSync(`packages/utils/dist/${entry}.d.mts`)).toBe(true)
      await expect(import(`../packages/utils/dist/${entry}.mjs`)).resolves.toBeDefined()
    }
    expect(existsSync('packages/utils/dist/index.mjs')).toBe(false)
  })

  it('rejects third-party imports and allows Node plus local imports', () => {
    const forbidden = run('utils-forbidden-import.mjs')
    expect(forbidden).toContain('utils-no-third-party-runtime-dependencies')
    const allowed = run('utils-node-and-local-import.mjs')
    expect(allowed).toContain('no dependency violations found')
    expect(run('packages/utils/dist')).toContain('no dependency violations found')
  })

  it('has no third-party runtime dependency declarations', () => {
    const manifest = JSON.parse(readFileSync('packages/utils/package.json', 'utf8')) as Record<
      string,
      unknown
    >
    expect(manifest.dependencies).toBeUndefined()
    expect(manifest.optionalDependencies).toBeUndefined()
    expect(manifest.peerDependencies).toBeUndefined()
  })
})

function run(file: string): string {
  try {
    return execFileSync(
      cruise,
      [
        'exec',
        'depcruise',
        '--config',
        '.dependency-cruiser.cjs',
        file.startsWith('packages/') ? file : `${fixture}/${file}`,
      ],
      { encoding: 'utf8' },
    )
  } catch (error) {
    return `${(error as { stdout?: string }).stdout ?? ''}${(error as { stderr?: string }).stderr ?? ''}`
  }
}
