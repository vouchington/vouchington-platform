import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

const packages = ['browser-crawl', 'domain-verification']
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

describe('new package manifests', () => {
  it.each(packages)('builds and exposes the declared public entrypoint for %s', (directory) => {
    rmSync(`packages/${directory}/dist`, { recursive: true, force: true })
    execFileSync(pnpm, ['--filter', `@vouchington/${directory}`, 'run', 'build'], {
      encoding: 'utf8',
    })
    const manifest = JSON.parse(readFileSync(`packages/${directory}/package.json`, 'utf8')) as {
      exports: Record<string, { import: string }>
      files: string[]
    }
    expect(manifest.files).toEqual(['dist', 'README.md', 'LICENSE'])
    const entry = manifest.exports['.']?.import
    expect(entry).toBeTruthy()
    const file = `packages/${directory}/${entry}`
    expect(existsSync(file)).toBe(true)
    execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(pathToFileURL(resolve(file)).href)})`,
    ])
  })
})
