import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.m?tsx?$/.test(file) && !/\.test\.|test-helpers/.test(file))
    .map((file) => join(dir, file))
}

describe('injected fetch types', () => {
  // Bun's fetch type adds members such as preconnect, so wrapper fetches fail to match `typeof fetch`
  it('types public fetch options as call signatures, not typeof fetch', () => {
    const offenders: string[] = []
    for (const directory of readdirSync('packages')) {
      for (const file of sourceFiles(join('packages', directory, 'src'))) {
        for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
          if (/(?<!as )typeof (globalThis\.)?fetch\b/.test(line))
            offenders.push(`${file}:${index + 1}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
