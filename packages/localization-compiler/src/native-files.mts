import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type GeneratedNativeFile = Readonly<{
  path: string
  content: string
}>

export type SyncGeneratedNativeFilesOptions = Readonly<{
  outputRoot: string
  files: readonly GeneratedNativeFile[]
  check: boolean
  /** Relative directories under `outputRoot` checked for extra/orphan files when `check` is true. */
  generatedRoots?: readonly string[]
}>

/**
 * Writes generated native resource files under `outputRoot`, or verifies in `check` mode that all
 * expected files match on disk and no extra files remain inside `generatedRoots`.
 */
export async function syncGeneratedNativeFiles(
  options: SyncGeneratedNativeFilesOptions,
): Promise<void> {
  const expected = new Map(options.files.map((file) => [file.path, file.content]))
  if (options.check) {
    await checkGeneratedFiles(options.outputRoot, expected, options.generatedRoots ?? [])
    return
  }
  await Promise.all(
    [...expected].map(async ([path, content]) => {
      const destination = join(options.outputRoot, path)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, content)
    }),
  )
}

async function checkGeneratedFiles(
  root: string,
  expected: ReadonlyMap<string, string>,
  generatedRoots: readonly string[],
): Promise<void> {
  const checked = await Promise.all(
    [...expected].map(async ([path, content]) => {
      try {
        return (await readFile(join(root, path), 'utf8')) === content ? null : `stale ${path}`
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return `missing ${path}`
        throw error
      }
    }),
  )
  const actual = (await Promise.all(generatedRoots.map((path) => listFiles(root, path)))).flat()
  const extra = actual.flatMap((path) => (expected.has(path) ? [] : [`extra ${path}`]))
  const problems = [...checked.filter((problem) => problem !== null), ...extra]
  if (problems.length > 0) {
    throw new Error(`Native localization resources are out of date:\n${problems.join('\n')}`)
  }
}

async function listFiles(root: string, directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(join(root, directory), { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return (
    await Promise.all(
      entries.map((entry) => {
        const child = `${directory}/${entry.name}`
        return entry.isDirectory() ? listFiles(root, child) : Promise.resolve([child])
      }),
    )
  ).flat()
}
