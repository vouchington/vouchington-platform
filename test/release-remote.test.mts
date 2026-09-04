import { beforeEach, describe, expect, it, vi } from 'vitest'

const childProcess = vi.hoisted(() => ({ execFileSync: vi.fn() }))
vi.mock('node:child_process', () => childProcess)

import {
  createMissingGitHubReleases,
  publishMissing,
  remoteReleaseComplete,
} from '../scripts/release-remote.mts'
import { checkoutReleaseCommit, tagPlan } from '../scripts/release-git.mts'
import type { StoredReleasePlan } from '../scripts/release-plan.mts'

const plan: StoredReleasePlan = {
  changedManifests: ['packages/base/package.json', 'packages/dependent/package.json'],
  releases: [
    {
      bump: 'major',
      directory: 'base',
      fromVersion: '1.0.0',
      name: '@vouchington/base',
      toVersion: '2.0.0',
    },
    {
      bump: 'major',
      directory: 'dependent',
      fromVersion: '1.0.0',
      name: '@vouchington/dependent',
      toVersion: '2.0.0',
    },
  ],
  selectedPackage: '@vouchington/base',
}

beforeEach(() => childProcess.execFileSync.mockReset())

describe('resumable release operations', () => {
  it('recognizes a fully published and announced plan', () => {
    childProcess.execFileSync.mockReturnValue(Buffer.from('2.0.0'))

    expect(remoteReleaseComplete(plan)).toBe(true)
    expect(childProcess.execFileSync).toHaveBeenCalledTimes(5)
    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      'gh',
      ['api', 'repos/{owner}/{repo}', '--silent'],
      expect.objectContaining({ encoding: 'utf8' }),
    )
    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      'npm',
      ['view', '@vouchington/base@2.0.0', 'version', '--json'],
      expect.objectContaining({ encoding: 'utf8' }),
    )
    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      'gh',
      ['api', 'repos/{owner}/{repo}/releases/tags/base-v2.0.0', '--silent'],
      expect.objectContaining({ encoding: 'utf8' }),
    )
  })

  it('recognizes an incomplete plan when the npm version is missing', () => {
    childProcess.execFileSync.mockImplementation((executable, arguments_: string[]) => {
      if (executable === 'npm' && arguments_[1] === '@vouchington/dependent@2.0.0')
        throw commandError('npm error code E404')
      return Buffer.from('2.0.0')
    })

    expect(remoteReleaseComplete(plan)).toBe(false)
  })

  it('recognizes a missing GitHub release after confirming repository access', () => {
    childProcess.execFileSync.mockImplementation((executable, arguments_: string[] = []) => {
      if (executable === 'gh' && arguments_[1]?.endsWith('base-v2.0.0'))
        throw commandError('gh: Not Found (HTTP 404)')
      return Buffer.from('2.0.0')
    })

    expect(remoteReleaseComplete(plan)).toBe(false)
  })

  it('propagates a repository-level 404', () => {
    childProcess.execFileSync.mockImplementation((executable, arguments_: string[] = []) => {
      if (executable === 'gh' && arguments_[1] === 'repos/{owner}/{repo}')
        throw commandError('gh: Not Found (HTTP 404)')
      return Buffer.from('2.0.0')
    })

    expect(() => remoteReleaseComplete(plan)).toThrow('lookup failed')
  })

  it('skips versions and GitHub releases that already exist', () => {
    childProcess.execFileSync.mockImplementation((executable, arguments_: string[] = []) => {
      if (arguments_[0] === 'view' && arguments_[1]?.includes('dependent'))
        throw commandError('npm error code E404')
      if (executable === 'gh' && arguments_[1]?.endsWith('dependent-v2.0.0'))
        throw commandError('gh: Not Found (HTTP 404)')
      return Buffer.from('2.0.0')
    })

    publishMissing(plan)
    createMissingGitHubReleases(plan)

    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      'pnpm',
      ['publish', '--access', 'public', '--no-git-checks'],
      expect.objectContaining({ cwd: 'packages/dependent' }),
    )
    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['create', 'dependent-v2.0.0']),
      { stdio: 'inherit' },
    )
  })

  it.each([
    ['npm', 'npm error code E401'],
    ['npm', 'npm error code E429'],
    ['npm', 'getaddrinfo ENOTFOUND registry.npmjs.org'],
    ['gh', 'gh: HTTP 401'],
    ['gh', 'gh: HTTP 500'],
    ['gh', 'request failed: connection reset'],
  ])('propagates %s lookup failures', (failedExecutable, message) => {
    childProcess.execFileSync.mockImplementation((executable) => {
      if (executable === failedExecutable) throw commandError(message)
      return Buffer.from('2.0.0')
    })

    expect(() => remoteReleaseComplete(plan)).toThrow('lookup failed')
  })
})

describe('publishMissing idempotency', () => {
  it('treats a "previously published" conflict on stdout as an idempotent success', () => {
    childProcess.execFileSync.mockImplementation((executable, arguments_: string[] = []) => {
      if (executable === 'npm') throw commandError('npm error code E404')
      if (executable === 'pnpm' && arguments_[0] === 'publish') {
        throw commandErrorOnStdout(
          'You cannot publish over the previously published versions: 2.0.0.',
        )
      }
      return Buffer.from('2.0.0')
    })

    expect(() => publishMissing(plan)).not.toThrow()
  })

  it('treats a "previously published" conflict on stderr as an idempotent success', () => {
    childProcess.execFileSync.mockImplementation((executable, arguments_: string[] = []) => {
      if (executable === 'npm') throw commandError('npm error code E404')
      if (executable === 'pnpm' && arguments_[0] === 'publish') {
        throw commandError('You cannot publish over the previously published versions: 2.0.0.')
      }
      return Buffer.from('2.0.0')
    })

    expect(() => publishMissing(plan)).not.toThrow()
  })

  it('rethrows a genuine publish failure such as an authentication error', () => {
    childProcess.execFileSync.mockImplementation((executable, arguments_: string[] = []) => {
      if (executable === 'npm') throw commandError('npm error code E404')
      if (executable === 'pnpm' && arguments_[0] === 'publish') {
        throw commandError(
          '403 Forbidden - PUT https://registry.npmjs.org/... - authentication required',
        )
      }
      return Buffer.from('2.0.0')
    })

    expect(() => publishMissing(plan)).toThrow('lookup failed')
  })
})

describe('release git state', () => {
  it('checks out the one commit shared by all release tags', () => {
    childProcess.execFileSync.mockImplementation((_executable, arguments_: string[] = []) =>
      arguments_[0] === 'rev-list' ? 'abc123\n' : Buffer.from(''),
    )

    checkoutReleaseCommit(plan)

    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      'git',
      ['checkout', '--detach', 'abc123'],
      {
        stdio: 'inherit',
      },
    )
  })

  it('rejects release tags from different commits', () => {
    childProcess.execFileSync.mockImplementation((_executable, arguments_: string[] = []) =>
      arguments_[3]?.startsWith('base-') ? 'abc123\n' : 'def456\n',
    )

    expect(() => checkoutReleaseCommit(plan)).toThrow('do not share one commit')
  })

  it('keeps matching tags and creates missing tags', () => {
    childProcess.execFileSync.mockImplementation((_executable, arguments_: string[] = []) => {
      if (arguments_[0] === 'rev-parse') return 'abc123\n'
      if (arguments_[3]?.startsWith('base-')) return 'abc123\n'
      if (arguments_[0] === 'rev-list') throw new Error('missing')
      return Buffer.from('')
    })

    tagPlan(plan)

    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      'git',
      ['tag', '-a', 'dependent-v2.0.0', '-m', '@vouchington/dependent v2.0.0'],
      { stdio: 'inherit' },
    )
  })
})

function commandError(stderr: string): Error {
  return Object.assign(new Error('lookup failed'), {
    stderr,
    stdout: '',
  })
}

function commandErrorOnStdout(stdout: string): Error {
  return Object.assign(new Error('lookup failed'), {
    stderr: '',
    stdout,
  })
}
