import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

const cruise = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const fixture = 'test/fixtures/dependency-cruiser'

describe('utils dependency boundary', () => {
  beforeAll(() => {
    rmSync('packages/utils/dist', { recursive: true, force: true })
    execFileSync(cruise, ['run', 'build'], { encoding: 'utf8' })
  })

  it('publishes every explicit subpath and no root export', () => {
    const manifest = JSON.parse(readFileSync('packages/utils/package.json', 'utf8')) as {
      exports: Record<string, unknown>
    }
    for (const subpath of Object.keys(manifest.exports)) {
      expect(subpath).not.toBe('.')
      const entry = subpath.replace(/^\.\//, '')
      expect(existsSync(`packages/utils/dist/${entry}.mjs`)).toBe(true)
      expect(existsSync(`packages/utils/dist/${entry}.d.mts`)).toBe(true)
      importBuiltModule(`packages/utils/dist/${entry}.mjs`)
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

  it('surfaces native module import failures', () => {
    expect(() => importBuiltModule('packages/utils/dist/does-not-exist.mjs')).toThrow(
      /Failed to import packages\/utils\/dist\/does-not-exist\.mjs:[\s\S]*ERR_MODULE_NOT_FOUND/,
    )
  })
})

function importBuiltModule(file: string): void {
  const moduleUrl = pathToFileURL(resolve(file)).href
  try {
    execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', `await import(${JSON.stringify(moduleUrl)})`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim()
    throw new Error(stderr ? `Failed to import ${file}:\n${stderr}` : `Failed to import ${file}`, {
      cause: error,
    })
  }
}

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
