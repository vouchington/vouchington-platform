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
    expect(childProcess.execFileSync).toHaveBeenCalledTimes(4)
  })

  it('recognizes an incomplete plan', () => {
    childProcess.execFileSync.mockImplementation((executable, arguments_: string[]) => {
      if (executable === 'npm' && arguments_[1] === '@vouchington/dependent@2.0.0')
        throw new Error('not found')
      return Buffer.from('2.0.0')
    })

    expect(remoteReleaseComplete(plan)).toBe(false)
  })

  it('skips versions and GitHub releases that already exist', () => {
    childProcess.execFileSync.mockImplementation((executable, arguments_: string[] = []) => {
      if (arguments_[0] === 'view' && arguments_[1]?.includes('dependent'))
        throw new Error('not found')
      if (executable === 'gh' && arguments_[0] === 'release' && arguments_[1] === 'view')
        if (arguments_[2] === 'dependent-v2.0.0') throw new Error('not found')
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
