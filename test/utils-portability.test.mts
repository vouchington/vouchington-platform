import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const sourceDirectory = 'packages/utils/src'
const builtins = new Set(builtinModules)
const specifierPattern = /\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/gu

function findNodeBuiltinImports(source: string): string[] {
  return [...source.matchAll(specifierPattern)]
    .map((match) => match[1]!)
    .filter((specifier) => specifier.startsWith('node:') || builtins.has(specifier))
}

describe('utils runtime portability', () => {
  it.each([
    ["import { readFile } from 'node:fs/promises'", ['node:fs/promises']],
    ["import { readFile } from 'fs'", ['fs']],
    ["export { createHash } from 'crypto'", ['crypto']],
    ["import type { Readable } from 'stream'", ['stream']],
    ["type T = import('node:stream').Readable", ['node:stream']],
    ["const x = require('child_process')", ['child_process']],
    ["import './local.mts'\nimport { x } from 'zod'", []],
  ])('recognizes Node built-in specifiers in %s', (source, expected) => {
    expect(findNodeBuiltinImports(source)).toEqual(expected)
  })

  it('keeps Node built-ins out of every non-test source file', () => {
    const offenders = readdirSync(sourceDirectory)
      .filter((name) => name.endsWith('.mts'))
      .filter((name) => !name.endsWith('.test.mts') && !name.endsWith('-test-helpers.mts'))
      .flatMap((name) =>
        findNodeBuiltinImports(readFileSync(join(sourceDirectory, name), 'utf8')).map(
          (specifier) => `${name} imports ${specifier}`,
        ),
      )
    expect(offenders).toEqual([])
  })
})
