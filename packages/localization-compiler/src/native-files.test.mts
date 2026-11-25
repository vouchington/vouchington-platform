import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { syncGeneratedNativeFiles } from './index.mts'

const directories: string[] = []

afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('syncGeneratedNativeFiles', () => {
  const files = [
    { path: 'swift/Generated/en.lproj/Localizable.strings', content: '"a" = "A";\n' },
    { path: 'dotnet/Generated/UiMessages.resx', content: '<root />\n' },
  ]
  const generatedRoots = ['swift/Generated', 'dotnet/Generated']

  it('writes files and checks missing, stale, and extra files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'native-files-'))
    directories.push(root)

    await expect(
      syncGeneratedNativeFiles({ outputRoot: root, files, check: true, generatedRoots }),
    ).rejects.toThrow('missing swift/Generated/en.lproj/Localizable.strings')

    await syncGeneratedNativeFiles({ outputRoot: root, files, check: false })
    expect(await readFile(join(root, files[0]!.path), 'utf8')).toBe('"a" = "A";\n')

    await expect(
      syncGeneratedNativeFiles({ outputRoot: root, files, check: true }),
    ).resolves.toBeUndefined()
    await expect(
      syncGeneratedNativeFiles({ outputRoot: root, files, check: true, generatedRoots }),
    ).resolves.toBeUndefined()

    await writeFile(join(root, files[0]!.path), 'stale')
    await expect(
      syncGeneratedNativeFiles({ outputRoot: root, files, check: true, generatedRoots }),
    ).rejects.toThrow(`stale ${files[0]!.path}`)
    await writeFile(join(root, files[0]!.path), files[0]!.content)

    const extra = join(root, 'dotnet/Generated/nested/extra.txt')
    await mkdir(join(extra, '..'), { recursive: true })
    await writeFile(extra, 'extra')
    await expect(
      syncGeneratedNativeFiles({ outputRoot: root, files, check: true, generatedRoots }),
    ).rejects.toThrow('extra dotnet/Generated/nested/extra.txt')
  })

  it('rethrows non-ENOENT read and directory-listing errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'native-files-err-'))
    directories.push(root)

    await mkdir(join(root, 'blocked.txt'))
    await expect(
      syncGeneratedNativeFiles({
        outputRoot: root,
        files: [{ path: 'blocked.txt', content: 'x' }],
        check: true,
      }),
    ).rejects.toMatchObject({ code: 'EISDIR' })

    const fileAsRoot = join(root, 'not-a-dir')
    await writeFile(fileAsRoot, 'file')
    await expect(
      syncGeneratedNativeFiles({
        outputRoot: root,
        files: [],
        check: true,
        generatedRoots: ['not-a-dir'],
      }),
    ).rejects.toMatchObject({ code: 'ENOTDIR' })
  })
})
