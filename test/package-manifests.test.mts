import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const packages = [
  'csv',
  'html-utils',
  'phone-validation',
  'uuid-v7',
  'frontmatter',
  'browser-crawl',
  'domain-verification',
  'wikimedia',
  'memberships',
  'worker-runtime',
  'rate-limit',
  'reviews',
  'moderation',
  'typed-entities',
]

describe('runtime package manifests', () => {
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

  it('declares a publishable UUIDv7 dependency from session-jwt', () => {
    const manifest = JSON.parse(readFileSync('packages/session-jwt/package.json', 'utf8')) as {
      dependencies: Record<string, string>
    }
    expectCaretSemverRange(manifest.dependencies['@vouchington/uuid-v7'])
  })

  it('declares GlideMQ as the worker runtime peer and development dependency', () => {
    const manifest = JSON.parse(readFileSync('packages/worker-runtime/package.json', 'utf8')) as {
      devDependencies: Record<string, string>
      peerDependencies: Record<string, string>
    }
    expectCaretSemverRange(manifest.devDependencies['glide-mq'])
    expect(manifest.peerDependencies['glide-mq']).toBe(manifest.devDependencies['glide-mq'])
  })
})

function importBuiltModule(file: string): void {
  const url = JSON.stringify(pathToFileURL(resolve(file)).href)
  const script = `const api = await import(${url}); if (typeof api.closeManagedValkeyClients === 'function') await api.closeManagedValkeyClients()`
  execFileSync(process.execPath, ['--input-type=module', '--eval', script], { stdio: 'pipe' })
}

function expectCaretSemverRange(value: string): void {
  expect(value).toMatch(
    /^\^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u,
  )
}
