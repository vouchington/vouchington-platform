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

  it('publishes separate media S3 object and presign subpaths', () => {
    expect(Object.keys(readManifest('media').exports as object)).toEqual([
      '.',
      './s3',
      './s3-presign',
    ])
    expect(existsSync('packages/media/dist/s3.mjs')).toBe(true)
    expect(existsSync('packages/media/dist/s3.d.mts')).toBe(true)
    expect(existsSync('packages/media/dist/s3-presign.mjs')).toBe(true)
    expect(existsSync('packages/media/dist/s3-presign.d.mts')).toBe(true)
    expect(readFileSync('packages/media/dist/s3.mjs', 'utf8')).not.toContain('s3-request-presigner')
    expect(() => importBuiltModule('packages/media/dist/s3.mjs')).not.toThrow()
    expect(() => importBuiltModule('packages/media/dist/s3-presign.mjs')).not.toThrow()
  })

  it('keeps runtime dependencies limited to direct package needs', () => {
    expectDependencyNames('embeds', [
      '@vouchington/crawler-html',
      '@vouchington/http-transport',
      'parse5',
    ])
    expect(readManifest('http-transport').dependencies).toBeUndefined()
    expectDependencyNames('image-resize', ['negotiator', 'sharp'])
    expectDependencyNames('media', ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'])
    expectDependencyNames('wikimedia', ['@jongleberry/api-server'])
    expect(readManifest('memberships').dependencies).toBeUndefined()
    expect(readManifest('worker-runtime').dependencies).toBeUndefined()
    expectDependencyNames('typed-entities', ['@vouchington/utils'])
  })

  it('keeps membership declarations utility-only and product-neutral', () => {
    const declarations = readFileSync('packages/memberships/dist/index.d.mts', 'utf8')
    expect(declarations).not.toMatch(
      /stripe|filaments|voucha|membership_skus|\bplus\b|\bpro\b|select /i,
    )
    expect(declarations).not.toMatch(
      /Capability|Normalized.*Webhook|RefundablePayment|MembershipProviderOperation|LifecycleFields/,
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

function expectDependencyNames(name: (typeof packages)[number], expected: string[]): void {
  const dependencies = (readManifest(name).dependencies ?? {}) as Record<string, string>
  expect(Object.keys(dependencies).toSorted()).toEqual(expected.toSorted())
}

function importBuiltModule(file: string): void {
  const url = JSON.stringify(pathToFileURL(resolve(file)).href)
  const script = `const api = await import(${url}); if (typeof api.closeManagedValkeyClients === 'function') await api.closeManagedValkeyClients()`
  execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
