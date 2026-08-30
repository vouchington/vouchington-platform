import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const packages = [
  'embeds',
  'http-transport',
  'image-resize',
  'media',
  'wikimedia',
  'memberships',
  'worker-runtime',
  'rate-limit',
  'reviews',
  'moderation',
  'typed-entities',
] as const

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

  it('publishes the media S3 subpath', () => {
    expect(Object.keys(readManifest('media').exports as object)).toEqual(['.', './s3'])
    expect(existsSync('packages/media/dist/s3.mjs')).toBe(true)
    expect(existsSync('packages/media/dist/s3.d.mts')).toBe(true)
    expect(() => importBuiltModule('packages/media/dist/s3.mjs')).not.toThrow()
  })

  it('keeps runtime dependencies limited to direct package needs', () => {
    expect(readManifest('embeds').dependencies).toEqual({
      '@vouchington/crawler-html': '^0.0.0',
      '@vouchington/http-transport': '^0.0.0',
      parse5: '^8.0.0',
    })
    expect(readManifest('http-transport').dependencies).toBeUndefined()
    expect(readManifest('image-resize').dependencies).toEqual({
      negotiator: '^1.1.0',
      sharp: '^0.35.3',
    })
    expect(readManifest('media').dependencies).toEqual({
      '@aws-sdk/client-s3': '^3.1116.0',
      '@aws-sdk/s3-request-presigner': '^3.1116.0',
    })
    expect(readManifest('wikimedia').dependencies).toEqual({
      '@jongleberry/api-server': '^2.1.0',
    })
    expect(readManifest('memberships').dependencies).toBeUndefined()
    expect(readManifest('worker-runtime').dependencies).toBeUndefined()
    expect(readManifest('rate-limit').dependencies).toEqual({
      valkyries: '^0.8.0',
    })
    expect(readManifest('reviews').dependencies).toEqual({
      '@jongleberry/api-server': '^2.1.0',
    })
    expect(readManifest('moderation').dependencies).toEqual({
      '@jongleberry/api-server': '^2.1.0',
    })
    expect(readManifest('typed-entities').dependencies).toEqual({
      '@vouchington/utils': '^0.3.0',
    })
  })

  it('keeps membership declarations provider- and product-neutral', () => {
    const declarations = readFileSync('packages/memberships/dist/index.d.mts', 'utf8')
    expect(declarations).not.toMatch(
      /stripe|filaments|voucha|membership_skus|\bplus\b|\bpro\b|select /i,
    )
  })

  it('publishes provider presets from an explicit subpath', () => {
    const exports = readManifest('embeds').exports as Record<
      string,
      { import: string; types: string }
    >
    expect(Object.keys(exports)).toEqual(['.', './providers'])
    expect(existsSync(`packages/embeds/${exports['./providers']!.import.replace('./', '')}`)).toBe(
      true,
    )
    expect(existsSync(`packages/embeds/${exports['./providers']!.types.replace('./', '')}`)).toBe(
      true,
    )
    expect(() =>
      importBuiltModule(`packages/embeds/${exports['./providers']!.import.replace('./', '')}`),
    ).not.toThrow()
  })
})

function readManifest(name: (typeof packages)[number]): Record<string, unknown> {
  return JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8')) as Record<
    string,
    unknown
  >
}

function importBuiltModule(file: string): void {
  const url = JSON.stringify(pathToFileURL(resolve(file)).href)
  const script = `const api = await import(${url}); if (typeof api.closeManagedValkeyClients === 'function') await api.closeManagedValkeyClients()`
  execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
