import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  loadWorkspacePackages,
  planMatchesRequest,
  planWorkspaceRelease,
  type StoredReleasePlan,
  type WorkspacePackage,
} from '../scripts/release-plan.mts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe('workspace release planning', () => {
  it('propagates a major release recursively in dependency order', () => {
    const result = planWorkspaceRelease(
      [
        workspacePackage('@vouchington/app-kit', '3.2.0', {
          dependencies: { '@vouchington/typed-entities': '^1.3.0' },
        }),
        workspacePackage('@vouchington/utils', '1.0.0'),
        workspacePackage('@vouchington/typed-entities', '1.3.0', {
          dependencies: { '@vouchington/utils': '^1.0.0' },
        }),
      ],
      '@vouchington/utils',
      'major',
    )

    expect(releaseVersions(result)).toEqual([
      ['@vouchington/utils', '2.0.0'],
      ['@vouchington/typed-entities', '2.0.0'],
      ['@vouchington/app-kit', '4.0.0'],
    ])
    expect(
      dependency(result, '@vouchington/typed-entities', 'dependencies', '@vouchington/utils'),
    ).toBe('^2.0.0')
    expect(
      dependency(result, '@vouchington/app-kit', 'dependencies', '@vouchington/typed-entities'),
    ).toBe('^2.0.0')
  })

  it('propagates a pre-1.0 minor compatibility break', () => {
    const result = planWorkspaceRelease(
      [
        workspacePackage('@vouchington/utils', '0.5.0'),
        workspacePackage('@vouchington/typed-entities', '0.1.0', {
          dependencies: { '@vouchington/utils': '^0.5.0' },
        }),
      ],
      '@vouchington/utils',
      'minor',
    )

    expect(releaseVersions(result)).toEqual([
      ['@vouchington/utils', '0.6.0'],
      ['@vouchington/typed-entities', '0.2.0'],
    ])
    expect(
      dependency(result, '@vouchington/typed-entities', 'dependencies', '@vouchington/utils'),
    ).toBe('^0.6.0')
  })

  it('reproduces the utils 0.4 to 0.5 workspace failure', () => {
    const result = planWorkspaceRelease(
      [
        workspacePackage('@vouchington/utils', '0.4.1'),
        workspacePackage('@vouchington/typed-entities', '0.1.0', {
          dependencies: { '@vouchington/utils': '^0.4.0' },
        }),
      ],
      '@vouchington/utils',
      'minor',
    )

    expect(releaseVersions(result)).toEqual([
      ['@vouchington/utils', '0.5.0'],
      ['@vouchington/typed-entities', '0.2.0'],
    ])
    expect(
      dependency(result, '@vouchington/typed-entities', 'dependencies', '@vouchington/utils'),
    ).toBe('^0.5.0')
  })

  it('leaves dependents unchanged when a caret accepts a patch', () => {
    const result = planWorkspaceRelease(
      [
        workspacePackage('@vouchington/utils', '0.5.1'),
        workspacePackage('@vouchington/typed-entities', '0.1.0', {
          dependencies: { '@vouchington/utils': '^0.5.1' },
        }),
      ],
      '@vouchington/utils',
      'patch',
    )

    expect(releaseVersions(result)).toEqual([['@vouchington/utils', '0.5.2']])
    expect(result.changedManifests).toEqual(['packages/utils/package.json'])
  })

  it('normalizes incompatible exact and ordinary ranges to a caret target', () => {
    const result = planWorkspaceRelease(
      [
        workspacePackage('@vouchington/base', '1.0.0'),
        workspacePackage('@vouchington/exact', '1.2.0', {
          dependencies: { '@vouchington/base': '1.0.0' },
        }),
        workspacePackage('@vouchington/tilde', '1.2.0', {
          dependencies: { '@vouchington/base': '~1.0.0' },
        }),
        workspacePackage('@vouchington/comparator', '1.2.0', {
          dependencies: { '@vouchington/base': '>=1.0.0 <2.0.0' },
        }),
      ],
      '@vouchington/base',
      'major',
    )

    expect(releaseVersions(result)).toEqual([
      ['@vouchington/base', '2.0.0'],
      ['@vouchington/comparator', '2.0.0'],
      ['@vouchington/exact', '2.0.0'],
      ['@vouchington/tilde', '2.0.0'],
    ])
    for (const name of ['@vouchington/exact', '@vouchington/tilde', '@vouchington/comparator'])
      expect(dependency(result, name, 'dependencies', '@vouchington/base')).toBe('^2.0.0')
  })

  it('updates dev-only dependents without publishing them and preserves workspace prefixes', () => {
    const result = planWorkspaceRelease(
      [
        workspacePackage('@vouchington/base', '1.0.0'),
        workspacePackage('@vouchington/dev-tool', '1.4.0', {
          devDependencies: { '@vouchington/base': 'workspace:^1.0.0' },
        }),
        workspacePackage('@vouchington/plugin', '1.4.0', {
          devDependencies: { '@vouchington/base': '^1.0.0' },
          peerDependencies: { '@vouchington/base': '^1.0.0' },
        }),
        workspacePackage('@vouchington/optional', '1.4.0', {
          optionalDependencies: { '@vouchington/base': '^1.0.0' },
        }),
      ],
      '@vouchington/base',
      'major',
    )

    expect(releaseVersions(result)).toEqual([
      ['@vouchington/base', '2.0.0'],
      ['@vouchington/optional', '2.0.0'],
      ['@vouchington/plugin', '2.0.0'],
    ])
    expect(
      dependency(result, '@vouchington/dev-tool', 'devDependencies', '@vouchington/base'),
    ).toBe('workspace:^2.0.0')
    expect(dependency(result, '@vouchington/plugin', 'devDependencies', '@vouchington/base')).toBe(
      '^2.0.0',
    )
    expect(dependency(result, '@vouchington/plugin', 'peerDependencies', '@vouchington/base')).toBe(
      '^2.0.0',
    )
    expect(
      dependency(result, '@vouchington/optional', 'optionalDependencies', '@vouchington/base'),
    ).toBe('^2.0.0')
  })

  it('models pnpm workspace shorthand ranges by their published form', () => {
    const patch = planWorkspaceRelease(
      [
        workspacePackage('@vouchington/base', '1.0.0'),
        workspacePackage('@vouchington/exact', '1.0.0', {
          dependencies: { '@vouchington/base': 'workspace:*' },
        }),
        workspacePackage('@vouchington/caret', '1.0.0', {
          dependencies: { '@vouchington/base': 'workspace:^' },
        }),
        workspacePackage('@vouchington/tilde', '1.0.0', {
          dependencies: { '@vouchington/base': 'workspace:~' },
        }),
      ],
      '@vouchington/base',
      'patch',
    )
    expect(releaseVersions(patch)).toEqual([
      ['@vouchington/base', '1.0.1'],
      ['@vouchington/exact', '1.0.1'],
    ])
    expect(dependency(patch, '@vouchington/exact', 'dependencies', '@vouchington/base')).toBe(
      'workspace:*',
    )

    const major = planWorkspaceRelease(patch.packages, '@vouchington/base', 'major')
    expect(releaseVersions(major)).toEqual([
      ['@vouchington/base', '2.0.0'],
      ['@vouchington/caret', '2.0.0'],
      ['@vouchington/exact', '2.0.0'],
      ['@vouchington/tilde', '2.0.0'],
    ])
    for (const [name, range] of [
      ['@vouchington/caret', 'workspace:^'],
      ['@vouchington/exact', 'workspace:*'],
      ['@vouchington/tilde', 'workspace:~'],
    ] as const)
      expect(dependency(major, name, 'dependencies', '@vouchington/base')).toBe(range)
  })

  it('rejects prerelease bumps, unsupported protocols, cycles, and unknown packages', () => {
    const packages = [workspacePackage('@vouchington/base', '1.0.0')]
    expect(() => planWorkspaceRelease(packages, '@vouchington/base', 'premajor' as never)).toThrow(
      'Unsupported release type',
    )
    expect(() => planWorkspaceRelease(packages, '@vouchington/missing', 'major')).toThrow(
      'Unknown workspace package',
    )
    expect(() =>
      planWorkspaceRelease(
        [
          workspacePackage('@vouchington/base', '1.0.0'),
          workspacePackage('@vouchington/dependent', '1.0.0', {
            dependencies: { '@vouchington/base': 'catalog:base' },
          }),
        ],
        '@vouchington/base',
        'major',
      ),
    ).toThrow('Unsupported workspace dependency range')
    expect(() =>
      planWorkspaceRelease(
        [
          workspacePackage('@vouchington/base', '1.0.0'),
          workspacePackage('@vouchington/dependent', '1.0.0', {
            dependencies: { '@vouchington/base': 'workspace:' },
          }),
        ],
        '@vouchington/base',
        'major',
      ),
    ).toThrow('Unsupported workspace dependency range')
    expect(() =>
      planWorkspaceRelease(
        [
          workspacePackage('@vouchington/base', '1.0.0'),
          workspacePackage('@vouchington/private', '1.0.0', {
            private: true,
            dependencies: { '@vouchington/base': '^1.0.0' },
          }),
        ],
        '@vouchington/base',
        'major',
      ),
    ).toThrow('private dependent')
    expect(() =>
      planWorkspaceRelease(
        [
          workspacePackage('@vouchington/a', '1.0.0', {
            dependencies: { '@vouchington/b': '^1.0.0' },
          }),
          workspacePackage('@vouchington/b', '1.0.0', {
            dependencies: { '@vouchington/a': '^1.0.0' },
          }),
        ],
        '@vouchington/a',
        'major',
      ),
    ).toThrow('Workspace dependency cycle')
  })

  it('loads only package directories that contain manifests', () => {
    const root = temporaryWorkspace()
    writeManifest(root, 'utils', { name: '@vouchington/utils', version: '1.0.0' })
    mkdirSync(join(root, 'packages', 'stale-dist'), { recursive: true })

    expect(loadWorkspacePackages(root).map(({ manifest }) => manifest.name)).toEqual([
      '@vouchington/utils',
    ])
  })

  it('applies the complete plan and writes a reusable plan artifact', () => {
    const root = temporaryWorkspace()
    const planPath = join(root, 'release-plan.json')
    writeManifest(root, 'utils', { name: '@vouchington/utils', version: '0.5.0' })
    writeManifest(root, 'typed-entities', {
      name: '@vouchington/typed-entities',
      version: '0.1.0',
      dependencies: { '@vouchington/utils': 'workspace:^' },
    })

    execFileSync(
      process.execPath,
      [
        join(process.cwd(), 'scripts/release.mts'),
        'prepare',
        '@vouchington/utils',
        'minor',
        planPath,
        join(root, '.github-release-plan.json'),
      ],
      { cwd: root },
    )
    execFileSync(
      process.execPath,
      [join(process.cwd(), 'scripts/release.mts'), 'verify', planPath],
      {
        cwd: root,
      },
    )

    expect(readManifest(root, 'utils').version).toBe('0.6.0')
    expect(readManifest(root, 'typed-entities')).toMatchObject({
      version: '0.2.0',
      dependencies: { '@vouchington/utils': 'workspace:^' },
    })
    expect(JSON.parse(readFileSync(planPath, 'utf8'))).toMatchObject({
      selectedPackage: '@vouchington/utils',
      releases: [
        { name: '@vouchington/utils', toVersion: '0.6.0' },
        { name: '@vouchington/typed-entities', toVersion: '0.2.0' },
      ],
    })
  })

  it('recomputes a fresh plan instead of resuming a persisted plan for a different bump', () => {
    const root = temporaryWorkspace()
    const planPath = join(root, 'release-plan.json')
    const persistedPath = join(root, '.github-release-plan.json')
    writeManifest(root, 'utils', { name: '@vouchington/utils', version: '0.1.0' })
    writeFileSync(
      persistedPath,
      `${JSON.stringify(
        {
          changedManifests: ['packages/utils/package.json'],
          releases: [
            {
              bump: 'minor',
              directory: 'utils',
              fromVersion: '0.0.0',
              name: '@vouchington/utils',
              toVersion: '0.1.0',
            },
          ],
          selectedPackage: '@vouchington/utils',
        },
        undefined,
        2,
      )}\n`,
    )

    execFileSync(
      process.execPath,
      [
        join(process.cwd(), 'scripts/release.mts'),
        'prepare',
        '@vouchington/utils',
        'patch',
        planPath,
        persistedPath,
      ],
      { cwd: root },
    )

    expect(readManifest(root, 'utils').version).toBe('0.1.1')
    expect(JSON.parse(readFileSync(planPath, 'utf8'))).toMatchObject({
      selectedPackage: '@vouchington/utils',
      releases: [{ name: '@vouchington/utils', bump: 'patch', toVersion: '0.1.1' }],
    })
    expect(JSON.parse(readFileSync(planPath, 'utf8'))).not.toHaveProperty('resumed')
  })
})

describe('planMatchesRequest', () => {
  const plan: StoredReleasePlan = {
    changedManifests: ['packages/utils/package.json'],
    releases: [
      {
        bump: 'minor',
        directory: 'utils',
        fromVersion: '0.0.0',
        name: '@vouchington/utils',
        toVersion: '0.1.0',
      },
    ],
    selectedPackage: '@vouchington/utils',
  }

  it('matches when the selected package and bump are unchanged', () => {
    expect(planMatchesRequest(plan, '@vouchington/utils', 'minor')).toBe(true)
  })

  it('does not match when the requested bump differs from the persisted plan', () => {
    expect(planMatchesRequest(plan, '@vouchington/utils', 'patch')).toBe(false)
  })

  it('does not match when the requested package differs from the persisted plan', () => {
    expect(planMatchesRequest(plan, '@vouchington/other', 'minor')).toBe(false)
  })

  it('does not match when the selected package is absent from the persisted releases', () => {
    const mismatched: StoredReleasePlan = { ...plan, selectedPackage: '@vouchington/missing' }
    expect(planMatchesRequest(mismatched, '@vouchington/missing', 'minor')).toBe(false)
  })
})

function workspacePackage(
  name: string,
  version: string,
  dependencies: Partial<WorkspacePackage['manifest']> = {},
): WorkspacePackage {
  return {
    directory: name.slice('@vouchington/'.length),
    manifest: { name, version, ...dependencies },
  }
}

function releaseVersions(result: ReturnType<typeof planWorkspaceRelease>): [string, string][] {
  return result.releases.map(({ name, toVersion }) => [name, toVersion])
}

function dependency(
  result: ReturnType<typeof planWorkspaceRelease>,
  packageName: string,
  field: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies',
  dependencyName: string,
): string | undefined {
  return result.packages.find(({ manifest }) => manifest.name === packageName)?.manifest[field]?.[
    dependencyName
  ]
}

function temporaryWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'release-plan-'))
  temporaryDirectories.push(directory)
  mkdirSync(join(directory, 'packages'))
  return directory
}

function writeManifest(root: string, directory: string, manifest: object): void {
  const path = join(root, 'packages', directory)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
}

function readManifest(root: string, directory: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8'),
  ) as Record<string, unknown>
}
