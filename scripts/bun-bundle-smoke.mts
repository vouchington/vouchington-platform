// Bundles every published export entry with Bun and checks that the bundle exposes the same
// exports as Node. The bundles run from a directory outside node_modules, so a dependency the
// bundler could not follow (for example one loaded through createRequire) fails or goes missing.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface ExportEntry {
  id: string
  file: string
}

type ExportShape = Record<string, string>
type ExportTarget = string | { import?: ExportTarget; default?: ExportTarget } | null

// Test-harness entries import vitest, which only loads inside a test runner.
const SKIPPED_SUBPATHS = new Set(['./testing'])

// Entries that cannot run under Bun for reasons other than bundling. Each one must keep failing,
// so the list stays current once Bun or the dependency catches up.
export const KNOWN_BUN_INCOMPATIBLE: Readonly<Record<string, string>> = {
  '@vouchington/image-resize':
    'sharp loads its platform binary at run time, so bundled builds must keep sharp external',
  '@vouchington/localization-compiler': 'uses node:sqlite, which Bun does not provide',
  '@vouchington/oauth-client/atproto':
    "its undici dependency calls webidl.util.markAsUncloneable, which Bun's runtime lacks",
}

export function listExportEntries(root: string): ExportEntry[] {
  const entries: ExportEntry[] = []
  for (const directory of readdirSync(join(root, 'packages')).toSorted()) {
    const packageDir = join(root, 'packages', directory)
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      name: string
      exports?: Record<string, ExportTarget>
    }
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      if (SKIPPED_SUBPATHS.has(subpath)) continue
      const file = runtimeFile(target)
      if (!file) continue
      const id = subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`
      entries.push({ id, file: resolve(packageDir, file) })
    }
  }
  return entries
}

function runtimeFile(target: ExportTarget): string | undefined {
  if (typeof target === 'string') return target
  if (!target) return undefined
  return runtimeFile(target.import ?? target.default ?? null)
}

export function shapeOf(module: Record<string, unknown>): ExportShape {
  return Object.fromEntries(
    Object.keys(module)
      .toSorted()
      .map((key) => [key, typeof module[key]]),
  )
}

export function diffShapes(node: ExportShape, bun: ExportShape): string[] {
  const keys = [...new Set([...Object.keys(node), ...Object.keys(bun)])].toSorted()
  return keys
    .filter((key) => node[key] !== bun[key])
    .map((key) => `${key}: node ${node[key] ?? 'missing'}, bun ${bun[key] ?? 'missing'}`)
}

function runBun(args: string[], cwd: string): string {
  return execFileSync('bun', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function bunErrorMessage(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr?.trim()
  return stderr ? stderr.split('\n').slice(0, 8).join('\n  ') : String(error)
}

async function main(): Promise<void> {
  const entries = listExportEntries(process.cwd())
  const dir = mkdtempSync(join(tmpdir(), 'bun-bundle-smoke-'))
  try {
    const failures: string[] = []
    for (const [index, entry] of entries.entries()) {
      const source = join(dir, `entry-${index}.mjs`)
      const outdir = join(dir, `bundle-${index}`)
      writeFileSync(
        source,
        `import * as m from ${JSON.stringify(entry.file)}\n` +
          `const shape = Object.fromEntries(Object.keys(m).sort().map((k) => [k, typeof m[k]]))\n` +
          `console.log(JSON.stringify(shape))\n`,
      )
      const node = shapeOf(
        (await import(pathToFileURL(entry.file).href)) as Record<string, unknown>,
      )
      let bun: ExportShape
      try {
        // Native addons and wasm are emitted as assets next to the bundle, so each gets a directory
        runBun(['build', '--target=bun', '--outdir', outdir, source], dir)
        // --no-install stops Bun from fetching a dependency the bundle left out, which hides the bug
        const output = runBun(['--no-install', join(outdir, `entry-${index}.js`)], dir)
        bun = JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as ExportShape
      } catch (error) {
        if (!Object.hasOwn(KNOWN_BUN_INCOMPATIBLE, entry.id)) {
          failures.push(`${entry.id}: ${bunErrorMessage(error)}`)
        }
        continue
      }
      const diff = diffShapes(node, bun)
      if (diff.length > 0) failures.push(`${entry.id}:\n  ${diff.join('\n  ')}`)
      else if (Object.hasOwn(KNOWN_BUN_INCOMPATIBLE, entry.id)) {
        failures.push(`${entry.id}: now runs under Bun; remove it from KNOWN_BUN_INCOMPATIBLE`)
      }
    }

    if (failures.length > 0) {
      console.error(`Bun bundles differ from Node for ${failures.length} entries:\n`)
      console.error(failures.join('\n\n'))
      process.exitCode = 1
      return
    }
    console.log(`Bun bundles match Node for all ${entries.length} export entries.`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (import.meta.main) await main()
