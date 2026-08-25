import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packages = ['crawler-html', 'rss-parser', 'rss-crawler', 'robots']

describe('crawler package catalog', () => {
  it('publishes the crawler package manifests and built public entrypoints', () => {
    for (const directory of packages) {
      const manifest = JSON.parse(readFileSync(`packages/${directory}/package.json`, 'utf8')) as {
        name: string
        exports: { '.': { import: string; types: string } }
        license: string
      }
      expect(manifest.name).toBe(`@vouchington/${directory}`)
      expect(manifest.license).toBe('MIT')
      expect(manifest.exports['.'].import).toBe('./dist/index.mjs')
      expect(manifest.exports['.'].types).toBe('./dist/index.d.mts')
      expect(existsSync(`packages/${directory}/README.md`)).toBe(true)
      expect(existsSync(`packages/${directory}/LICENSE`)).toBe(true)
    }
  })
})
