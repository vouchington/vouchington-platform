import { lstat, readdir, realpath } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { assertSafeDirectory, lstatOrNull } from './file-safety.mts'

async function assertMarkdownTree(directory: string, jsonDirectory: string): Promise<void> {
  const jsonStats = await lstat(jsonDirectory, { bigint: true })
  const jsonIdentity = `${jsonStats.dev}:${jsonStats.ino}`
  const seen = new Set<string>()
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop()!
    const stats = await lstat(current, { bigint: true })
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Unsafe generated PostgreSQL schema snapshot path: ${current}`)
    }
    const identity = `${stats.dev}:${stats.ino}`
    if (identity === jsonIdentity) {
      throw new Error('Markdown output root must not contain the JSON snapshot root')
    }
    if (seen.has(identity)) {
      throw new Error('Markdown output tree must not contain directory aliases')
    }
    seen.add(identity)
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory()) pending.push(join(current, entry.name))
    }
  }
}

export async function assertSeparateMarkdownRoot(
  root: string,
  markdownRoot: string,
): Promise<void> {
  await Promise.all([assertSafeDirectory(root, false), assertSafeDirectory(markdownRoot, false)])
  const [jsonDirectory, markdownDirectory] = await Promise.all([
    realpath(root),
    realpath(markdownRoot),
  ])
  const firstComponent = relative(resolve(root), resolve(markdownRoot)).split(sep)[0]
  const reserved = await Promise.all(
    ['schema.json', 'schema.md'].map((name) => lstatOrNull(join(jsonDirectory, name))),
  )
  if (
    firstComponent === 'schema.json' ||
    firstComponent === 'schema.md' ||
    reserved.some((stats) => stats?.isDirectory())
  ) {
    throw new Error('Markdown output root must not overlap reserved snapshot paths')
  }
  await assertMarkdownTree(markdownDirectory, jsonDirectory)
}
