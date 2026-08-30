import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const sourceDirectory = 'packages/typed-entities/src'
const sources = readdirSync(sourceDirectory)
  .filter((file) => file.endsWith('.mts') && !file.endsWith('.test.mts'))
  .map((file) => readFileSync(`${sourceDirectory}/${file}`, 'utf8'))
  .join('\n')

describe('@vouchington/typed-entities product boundary', () => {
  it('contains no application identifiers or persistence implementation', () => {
    expect(sources).not.toMatch(/filaments|greesy|voucha/i)
    expect(sources).not.toMatch(/\b(?:select|insert|update|delete)\s+(?:from|into)?\b/i)
  })

  it('imports only relative modules and product-neutral utilities', () => {
    const imports = [...sources.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
    expect(
      imports.every((value) => value?.startsWith('.') || value?.startsWith('@vouchington/utils/')),
    ).toBe(true)
  })
})
