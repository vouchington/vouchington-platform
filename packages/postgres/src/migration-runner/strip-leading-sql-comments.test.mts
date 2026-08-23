import { describe, expect, it } from 'vitest'

import { stripLeadingSqlComments } from './strip-leading-sql-comments.mts'

describe('stripLeadingSqlComments', () => {
  it('strips line and block comments', () => {
    expect(stripLeadingSqlComments('-- foo')).toBe('')
    expect(stripLeadingSqlComments('-- foo\nSELECT 1')).toBe('SELECT 1')
    expect(stripLeadingSqlComments('/* a */ /* b */ SELECT 1')).toBe('SELECT 1')
    expect(stripLeadingSqlComments('/* unclosed')).toBe('/* unclosed')
    expect(stripLeadingSqlComments('SELECT 1')).toBe('SELECT 1')
  })
})
