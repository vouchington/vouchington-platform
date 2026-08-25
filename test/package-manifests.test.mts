import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const packages = [
  'csv',
  'html-utils',
  'phone-validation',
  'observability',
  'uuid-v7',
  'frontmatter',
]
describe('focused runtime package manifests', () => {
  it.each(packages)('publishes a single explicit public API for %s', (directory) => {
    const manifest = JSON.parse(readFileSync(`packages/${directory}/package.json`, 'utf8')) as {
      exports: Record<string, { import: string; types: string }>
      files: string[]
    }
    const entry = manifest.exports['.']
    expect(entry).toBeDefined()
    expect(existsSync(`packages/${directory}/${entry.import.replace('./', '')}`)).toBe(true)
    expect(existsSync(`packages/${directory}/${entry.types.replace('./', '')}`)).toBe(true)
    expect(manifest.files).toContain('LICENSE')
    expect(manifest.files).toContain('README.md')
  })
})
