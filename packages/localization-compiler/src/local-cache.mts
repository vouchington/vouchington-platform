import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { compareCodePoints } from '@vouchington/localization'
import { compileLocalizationSqlite } from './compile.mts'
import { loadCatalogDirectory } from './load.mts'

export type EnsureCompiledCatalogOptions = Readonly<{
  source: string
  output: string
  /** Extra files (such as compiler/package manifests) mixed into the cache digest. */
  extraHashFiles?: readonly string[]
}>

type CatalogFileEntry = Readonly<{
  file: string
  relativePath: string
}>

function walkFiles(directory: string, root: string): CatalogFileEntry[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) return walkFiles(file, root)
    return entry.isFile()
      ? [{ file, relativePath: relative(root, file).replaceAll('\\', '/') }]
      : []
  })
}

/**
 * Computes a deterministic SHA-256 digest of all files under `source` (plus optional `extraFiles`
 * such as package manifests) for up-to-date checks before recompiling SQLite artifacts.
 */
export function catalogDirectoryDigest(source: string, extraFiles: readonly string[] = []): string {
  const root = resolve(source)
  const hash = createHash('sha256')
  for (const file of extraFiles) {
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  const files = walkFiles(root, root).toSorted((left, right) =>
    compareCodePoints(left.relativePath, right.relativePath),
  )
  for (const { file, relativePath } of files) {
    hash.update(relativePath)
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * Ensures `output` holds an up-to-date compiled SQLite catalog for `source`, caching the input
 * digest in `<output>.revision` and replacing both files atomically on change.
 */
export async function ensureCompiledLocalizationCatalog(
  options: EnsureCompiledCatalogOptions,
): Promise<string> {
  const resolvedOutput = resolve(options.output)
  const revisionPath = `${resolvedOutput}.revision`
  const digest = catalogDirectoryDigest(options.source, options.extraHashFiles)
  if (
    existsSync(resolvedOutput) &&
    existsSync(revisionPath) &&
    readFileSync(revisionPath, 'utf8') === digest
  ) {
    return resolvedOutput
  }

  mkdirSync(dirname(resolvedOutput), { recursive: true })
  const temporaryOutput = `${resolvedOutput}.${process.pid}.tmp`
  const temporaryRevision = `${revisionPath}.${process.pid}.tmp`
  try {
    const loaded = await loadCatalogDirectory(resolve(options.source))
    compileLocalizationSqlite(loaded.catalog, temporaryOutput)
    writeFileSync(temporaryRevision, digest)
    renameSync(temporaryOutput, resolvedOutput)
    renameSync(temporaryRevision, revisionPath)
  } finally {
    rmSync(temporaryOutput, { force: true })
    rmSync(temporaryRevision, { force: true })
  }
  return resolvedOutput
}
