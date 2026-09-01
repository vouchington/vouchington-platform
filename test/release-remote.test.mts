import { beforeEach, describe, expect, it, vi } from 'vitest'

const childProcess = vi.hoisted(() => ({ execFileSync: vi.fn() }))
vi.mock('node:child_process', () => childProcess)

import {
  createMissingGitHubReleases,
  publishMissing,
  remoteReleaseComplete,
} from '../scripts/release-remote.mts'
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
