import { readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { buildSchemaSnapshot } from './build-snapshot.mts'
import { readSchemaCatalog } from './catalog-queries.mts'
import {
  assertSafeDirectory,
  assertSafeExistingFilePath,
  ensureSafeParentDirectory,
  lstatOrNull,
  writeGeneratedFile,
} from './file-safety.mts'
import { markdownFilesOnDisk } from './markdown-files.mts'
import { renderSchemaMarkdown } from './render-markdown.mts'
import type { CatalogQuery, SchemaGrowthMaps, SchemaSnapshot } from './types.mts'

type SnapshotFile = { root: string; content: string }

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortKeys(nested)]),
    )
  }
  return value
}

async function identityFormat(_path: string, raw: string): Promise<string> {
  return raw
}

function assertSafeMarkdownPath(markdownRoot: string, path: string): string {
  const outputPath = resolve(markdownRoot, path)
  const relativePath = relative(markdownRoot, outputPath)
  if (
    isAbsolute(path) ||
    !path.endsWith('.md') ||
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Unsafe generated PostgreSQL schema Markdown path: ${path}`)
  }
  return outputPath
}

async function schemaSnapshotFiles(
  snapshot: SchemaSnapshot,
  markdown: Map<string, string>,
  root: string,
  markdownRoot: string | undefined,
  format: (path: string, raw: string) => Promise<string>,
  stringify: (value: unknown) => string,
): Promise<Map<string, SnapshotFile>> {
  const jsonPath = resolve(root, 'schema.json')
  const markdownDirectory = markdownRoot ?? join(root, 'markdown')
  const [json, ...formattedMarkdown] = await Promise.all([
    format(jsonPath, stringify(snapshot)),
    ...[...markdown].map(async ([path, content]) => {
      const outputPath = assertSafeMarkdownPath(markdownDirectory, path)
      return [
        outputPath,
        { root: markdownRoot ?? root, content: await format(outputPath, content) },
      ] as const
    }),
  ])
  return new Map([[jsonPath, { root, content: json }], ...formattedMarkdown])
}

async function staleSchemaSnapshotFiles(files: Map<string, SnapshotFile>): Promise<string[]> {
  const results = await Promise.all(
    [...files].map(async ([path, { root, content }]) => {
      await assertSafeExistingFilePath(root, path)
      const actual = await readFile(path, 'utf8').catch((err: NodeJS.ErrnoException) =>
        /* v8 ignore next -- non-ENOENT read failures are host-specific */
        err.code === 'ENOENT' ? null : Promise.reject(err),
      )
      return actual === content ? null : path
    }),
  )
  return results.filter((path): path is string => path !== null)
}

async function extraMarkdownPaths(
  files: Map<string, SnapshotFile>,
  root: string,
  markdownRoot: string | undefined,
): Promise<string[]> {
  const expected = new Set(files.keys())
  const orphaned = (
    await markdownFilesOnDisk(resolve(markdownRoot ?? join(root, 'markdown')))
  ).filter((path) => !expected.has(path))
  const legacyPath = resolve(root, 'schema.md')
  const legacyExists = !expected.has(legacyPath) && (await lstatOrNull(legacyPath)) !== null
  return [...new Set([...orphaned, ...(legacyExists ? [legacyPath] : [])])]
}

export async function writeSchemaSnapshot({
  snapshot,
  markdown,
  root,
  markdownRoot,
  check = false,
  format = identityFormat,
  stringify = stableStringify,
}: {
  snapshot: SchemaSnapshot
  markdown: Map<string, string>
  root: string
  markdownRoot?: string
  check?: boolean
  format?: (path: string, raw: string) => Promise<string>
  stringify?: (value: unknown) => string
}): Promise<void> {
  if (markdownRoot !== undefined) await assertSafeDirectory(markdownRoot, false)
  const files = await schemaSnapshotFiles(snapshot, markdown, root, markdownRoot, format, stringify)
  if (!check) {
    await Promise.all([...files].map(([path, { root }]) => ensureSafeParentDirectory(root, path)))
    await Promise.all(
      [...files].map(([path, { root, content }]) => writeGeneratedFile(root, path, content)),
    )
    await Promise.all((await extraMarkdownPaths(files, root, markdownRoot)).map((path) => rm(path)))
    return
  }

  const stale = [
    ...(await staleSchemaSnapshotFiles(files)),
    ...(await extraMarkdownPaths(files, root, markdownRoot)),
  ].toSorted((left, right) => left.localeCompare(right))
  if (stale.length > 0) {
    throw new Error(
      [
        'PostgreSQL schema snapshot is stale. Regenerate it and commit:',
        ...stale.map((path) => `- ${path}`),
      ].join('\n'),
    )
  }
}

export async function generateSchemaSnapshot({
  query,
  growth,
  root,
  markdownRoot,
  check = false,
  format = identityFormat,
  stringify = stableStringify,
}: {
  query: CatalogQuery
  growth: SchemaGrowthMaps
  root: string
  markdownRoot?: string
  check?: boolean
  format?: (path: string, raw: string) => Promise<string>
  stringify?: (value: unknown) => string
}): Promise<void> {
  const snapshot = buildSchemaSnapshot(await readSchemaCatalog(query), growth)
  await writeSchemaSnapshot({
    snapshot,
    markdown: renderSchemaMarkdown(snapshot),
    root,
    ...(markdownRoot === undefined ? {} : { markdownRoot }),
    check,
    format,
    stringify,
  })
}
