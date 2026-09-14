import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compileLocalizationSqlite,
  openLocalizationDatabase,
  resolveLocalizationBatch,
} from './index.mts'

const paths: string[] = []
afterEach(() => paths.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

describe('route selector membership', () => {
  it('selects aliases through route membership while preserving aliases on the v1 wire', () => {
    const root = mkdtempSync(join(tmpdir(), 'localization-route-'))
    paths.push(root)
    const output = join(root, 'catalog.sqlite')
    compileLocalizationSqlite(
      {
        copies: [{ id: 'copy.posts', descriptor: null }],
        aliases: [
          { consumer: 'web', alias: 'web.nav.posts', copyId: 'copy.posts' },
          { consumer: 'web', alias: 'web.sidebar.posts', copyId: 'copy.posts' },
        ],
        translations: {
          'en-US': [{ id: 'copy.posts', value: 'Posts' }],
          es: [{ id: 'copy.posts', value: 'Publicaciones' }],
        },
        routeMembership: [
          { consumer: 'web', selectorId: 'web.route.channels.members', alias: 'web.nav.posts' },
          { consumer: 'web', selectorId: 'web.route.channels.members', alias: 'web.sidebar.posts' },
        ],
      },
      output,
    )
    const database = openLocalizationDatabase(output)
    try {
      expect(
        resolveLocalizationBatch(database, {
          consumer: 'web',
          locales: ['es'],
          selectors: ['web.route.channels.members'],
        }).messages,
      ).toEqual({
        'web.nav.posts': 'Publicaciones',
        'web.sidebar.posts': 'Publicaciones',
      })
      expect(
        resolveLocalizationBatch(database, {
          consumer: 'web',
          locales: ['es'],
          selectors: ['web.route.channels.*'],
        }).messages,
      ).toEqual({
        'web.nav.posts': 'Publicaciones',
        'web.sidebar.posts': 'Publicaciones',
      })
      expect(
        resolveLocalizationBatch(database, {
          consumer: 'web',
          locales: ['en'],
          selectors: ['web.nav.*'],
        }).messages,
      ).toEqual({ 'web.nav.posts': 'Posts' })
    } finally {
      database.close()
    }
  })
})
