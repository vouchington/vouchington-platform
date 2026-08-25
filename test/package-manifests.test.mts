import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const packages = ['csv', 'html-utils', 'phone-validation', 'uuid-v7', 'frontmatter']
describe('focused runtime package manifests', () => {
  beforeAll(() => execFileSync(pnpm, ['run', 'build'], { encoding: 'utf8' }))
  it.each(packages)('publishes a single explicit public API for %s', (directory) => {
    const manifest = JSON.parse(readFileSync(`packages/${directory}/package.json`, 'utf8')) as {
      exports: Record<string, { import: string; types: string }>
      files: string[]
    }
    expect(Object.keys(manifest.exports)).toEqual(['.'])
    const entry = manifest.exports['.']!
    expect(existsSync(`packages/${directory}/${entry.import.replace('./', '')}`)).toBe(true)
    expect(existsSync(`packages/${directory}/${entry.types.replace('./', '')}`)).toBe(true)
    expect(manifest.files).toContain('LICENSE')
    expect(manifest.files).toContain('README.md')
    expect(() =>
      importBuiltModule(`packages/${directory}/${entry.import.replace('./', '')}`),
    ).not.toThrow()
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
