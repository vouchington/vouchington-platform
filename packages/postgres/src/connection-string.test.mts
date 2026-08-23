import { describe, expect, it } from 'vitest'

import {
  buildDatabaseConnectionStringFromParts,
  resolveDatabaseConnectionString,
  withLibpqCompat,
} from './connection-string.mts'

describe('withLibpqCompat', () => {
  it('appends uselibpqcompat for sslmode=require', () => {
    expect(withLibpqCompat('postgres://localhost/db?sslmode=require')).toBe(
      'postgres://localhost/db?sslmode=require&uselibpqcompat=true',
    )
  })

  it('leaves other URLs unchanged', () => {
    expect(withLibpqCompat('postgres://localhost/db')).toBe('postgres://localhost/db')
    expect(withLibpqCompat('postgres://localhost/db?sslmode=require&uselibpqcompat=true')).toBe(
      'postgres://localhost/db?sslmode=require&uselibpqcompat=true',
    )
  })
})

describe('resolveDatabaseConnectionString', () => {
  it('prefers DATABASE_URL', () => {
    expect(resolveDatabaseConnectionString({ DATABASE_URL: 'postgres://example/db' })).toBe(
      'postgres://example/db',
    )
  })

  it('builds from parts when all are present', () => {
    expect(
      resolveDatabaseConnectionString({
        DATABASE_HOST: 'db.example',
        DATABASE_NAME: 'app',
        DATABASE_PASSWORD: 'secret',
        DATABASE_USER: 'app',
        DATABASE_PORT: '6543',
        DATABASE_SSLMODE: 'disable',
      }),
    ).toBe('postgresql://app:secret@db.example:6543/app?sslmode=disable')
  })

  it('throws when some parts are missing', () => {
    expect(() => resolveDatabaseConnectionString({ DATABASE_HOST: 'db.example' })).toThrow(
      'Missing database connection env vars',
    )
  })

  it('falls back to localhost and optional docker host', () => {
    expect(resolveDatabaseConnectionString({}, 'app')).toBe('postgres://localhost/app')
    expect(resolveDatabaseConnectionString({ DOCKER_HOST_IP: '10.0.0.2' }, 'app')).toBe(
      'postgres://postgres@10.0.0.2/app',
    )
  })
})

describe('buildDatabaseConnectionStringFromParts', () => {
  it('defaults port and sslmode', () => {
    expect(
      buildDatabaseConnectionStringFromParts({
        DATABASE_HOST: 'db.example',
        DATABASE_NAME: 'app',
        DATABASE_PASSWORD: 'secret',
        DATABASE_USER: 'app',
      }),
    ).toBe('postgresql://app:secret@db.example:5432/app?sslmode=require')
  })
})
