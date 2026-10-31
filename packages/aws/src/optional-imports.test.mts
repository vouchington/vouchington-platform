import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const IMPORT = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

function localImports(file: string): string[] {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  return [...source.matchAll(IMPORT)].map((m) => m[1] as string)
}

function closure(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen
  seen.add(entry)
  for (const spec of localImports(entry)) if (spec.startsWith('./')) closure(spec, seen)
  return seen
}

describe('optional peer isolation', () => {
  it.each(['./ses.mts', './sqs.mts', './firehose.mts', './cloudwatch.mts', './errors.mts'])(
    '%s does not transitively import @smithy/node-http-handler',
    (entry) => {
      for (const file of closure(entry)) {
        expect(localImports(file), file).not.toContain('@smithy/node-http-handler')
      }
    },
  )
})
