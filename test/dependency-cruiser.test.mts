import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

const cruise = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const fixture = 'test/fixtures/dependency-cruiser'

const packages = ['utils', 'server-utils']

describe('utils dependency boundary', () => {
  beforeAll(() => {
    for (const name of packages) rmSync(`packages/${name}/dist`, { recursive: true, force: true })
    execFileSync(cruise, ['run', 'build'], { encoding: 'utf8' })
  })

  it.each(packages)('publishes every explicit subpath and no root export for %s', (name) => {
    const manifest = JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8')) as {
      exports: Record<string, unknown>
    }
    for (const subpath of Object.keys(manifest.exports)) {
      expect(subpath).not.toBe('.')
      const entry = subpath.replace(/^\.\//, '')
      expect(existsSync(`packages/${name}/dist/${entry}.mjs`)).toBe(true)
      expect(existsSync(`packages/${name}/dist/${entry}.d.mts`)).toBe(true)
      importBuiltModule(`packages/${name}/dist/${entry}.mjs`)
    }
    expect(existsSync(`packages/${name}/dist/index.mjs`)).toBe(false)
  })

  it('rejects third-party imports and allows local imports', () => {
    const forbidden = run('utils-forbidden-import.mjs')
    expect(forbidden).toContain('utils-no-third-party-runtime-dependencies')
    expect(run('utils-local-import.mjs')).toContain('no dependency violations found')
    expect(run('packages/utils/dist')).toContain('no dependency violations found')
  })

  it.each(['utils-forbidden-node-import.mjs', 'utils-forbidden-bare-node-import.mjs'])(
    'rejects the Node built-in import in %s',
    (file) => {
      expect(run(file)).toContain('utils-no-node-builtins')
    },
  )

  it('allows Node built-ins in server-utils', () => {
    expect(run('server-utils-node-import.mjs')).toContain('no dependency violations found')
    expect(run('packages/server-utils/dist')).toContain('no dependency violations found')
  })

  it.each(packages)('has no runtime dependency declarations for %s', (name) => {
    const manifest = JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8')) as Record<
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
