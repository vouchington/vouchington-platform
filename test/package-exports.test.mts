import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const packages = ['http-transport', 'image-resize', 'wikimedia'] as const

describe('new package manifests and exports', () => {
  beforeAll(() => {
    for (const name of packages) rmSync(`packages/${name}/dist`, { recursive: true, force: true })
    execFileSync(pnpm, ['run', 'build'], { encoding: 'utf8' })
  })

  it('publishes built root exports', () => {
    for (const name of packages) {
      expect(existsSync(`packages/${name}/dist/index.mjs`)).toBe(true)
      expect(existsSync(`packages/${name}/dist/index.d.mts`)).toBe(true)
      expect(() => importBuiltModule(`packages/${name}/dist/index.mjs`)).not.toThrow()
    }
  })

  it('keeps runtime dependencies limited to direct package needs', () => {
    expect(readManifest('http-transport').dependencies).toBeUndefined()
    expect(readManifest('image-resize').dependencies).toEqual({
      negotiator: '^1.1.0',
      sharp: '^0.35.3',
    })
    expect(readManifest('wikimedia').dependencies).toEqual({
      '@jongleberry/api-server': '^2.1.0',
    })
  })
})

function readManifest(name: (typeof packages)[number]): Record<string, unknown> {
  return JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8')) as Record<
    string,
    unknown
  >
}

function importBuiltModule(file: string): void {
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(pathToFileURL(resolve(file)).href)})`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
}
