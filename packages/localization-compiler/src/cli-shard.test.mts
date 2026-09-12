import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CatalogMergeConflict, serializeCatalogShard } from '@vouchington/localization'
import { runLocalizationCli } from './index.mts'
import { runShardCli } from './cli-shard.mts'
import { sampleMessages } from './test-helpers.mts'

const paths: string[] = []

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('localization shard CLI', () => {
  it('upserts, removes, formats, and git-merges by message id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shard-cli-'))
    paths.push(root)
    const file = join(root, 'nav.json')
    const home = sampleMessages()[0]!
    await runLocalizationCli(['upsert', '--file', file, '--message', JSON.stringify(home)])
    expect(readFileSync(file, 'utf8')).toBe(serializeCatalogShard([home]))
    await runLocalizationCli([
      'upsert',
      '--file',
      file,
      '--message',
      JSON.stringify({ ...home, translations: { 'en-US': 'Home', es: 'Inicio' } }),
    ])
    const wrapped = join(root, 'wrapped.json')
    writeFileSync(file, serializeCatalogShard([home]))
    writeFileSync(wrapped, `${JSON.stringify({ messages: [home] })}\n`)
    const tags = join(root, 'tags.json')
    writeFileSync(tags, '{"nav.home":["chrome"]}\n')
    writeFileSync(join(root, 'notes.txt'), 'skip\n')
    const formatted: string[] = []
    await runLocalizationCli(['format', '--source', root], (value) => formatted.push(value))
    expect(formatted[0]).toMatch(/files/)
    expect(readFileSync(wrapped, 'utf8')).toBe(serializeCatalogShard([home]))
    expect(readFileSync(tags, 'utf8')).toBe('{"nav.home":["chrome"]}\n')
    await runLocalizationCli(['remove', '--file', file, '--id', 'nav.home'])
    expect(readFileSync(file, 'utf8')).toBe('[]\n')
    const ancestor = join(root, 'base.json')
    const ours = join(root, 'ours.json')
    const theirs = join(root, 'theirs.json')
    const save = sampleMessages()[1]!
    writeFileSync(ancestor, serializeCatalogShard([home]))
    writeFileSync(ours, serializeCatalogShard([home, save]))
    writeFileSync(theirs, serializeCatalogShard([home]))
    await runLocalizationCli(['git-merge', ancestor, ours, theirs])
    expect(readFileSync(ours, 'utf8')).toBe(serializeCatalogShard([save, home]))
    writeFileSync(ours, serializeCatalogShard([{ ...home, translations: { 'en-US': 'A' } }]))
    writeFileSync(theirs, serializeCatalogShard([{ ...home, translations: { 'en-US': 'B' } }]))
    await expect(runLocalizationCli(['git-merge', ancestor, ours, theirs])).rejects.toThrow(
      CatalogMergeConflict,
    )
    writeFileSync(ancestor, serializeCatalogShard([save]))
    writeFileSync(
      ours,
      serializeCatalogShard([{ ...save, translations: { ...save.translations, es: 'Guardar' } }]),
    )
    writeFileSync(
      theirs,
      serializeCatalogShard([
        { ...save, translations: { ...save.translations, fr: 'Enregistrer' } },
      ]),
    )
    await runLocalizationCli(['git-merge', ancestor, ours, theirs])
    expect(readFileSync(ours, 'utf8')).toBe(
      serializeCatalogShard([
        {
          ...save,
          translations: { ...save.translations, es: 'Guardar', fr: 'Enregistrer' },
        },
      ]),
    )
  })

  it('prints shard usage for missing flags', async () => {
    await expect(runLocalizationCli(['upsert'])).rejects.toThrow(/upsert --file/)
    await expect(
      runLocalizationCli(['upsert', '--file', 'x.json', '--message', '--nope']),
    ).rejects.toThrow(/upsert --file/)
    await expect(runLocalizationCli(['git-merge', 'a'])).rejects.toThrow(/git-merge/)
    expect(() => runShardCli('nope', [])).toThrow(/upsert --file/)
  })
})
