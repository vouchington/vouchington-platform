import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const packages = ['crawler-html', 'embeds', 'rss-parser', 'rss-crawler', 'robots']

describe('crawler package catalog', () => {
  it('builds and imports every public package entrypoint', async () => {
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    execFileSync(pnpm, ['--filter', '@vouchington/rss-parser', 'run', 'build'], {
      encoding: 'utf8',
    })
    execFileSync(pnpm, ['run', 'build'], {
      encoding: 'utf8',
    })
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
      expect(existsSync(`packages/${directory}/dist/index.mjs`)).toBe(true)
      expect(existsSync(`packages/${directory}/dist/index.d.mts`)).toBe(true)
      await import(pathToFileURL(resolve(`packages/${directory}/dist/index.mjs`)).href)
    }
  })
})
