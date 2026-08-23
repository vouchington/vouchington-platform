import pg from 'pg'

const BIGINT_OID = 20
const DATE_OID = 1082
const NUMERIC_OID = 1700
const TIMESTAMP_OID = 1114
const TIMESTAMPTZ_OID = 1184

let installed = false

export function installPgTypeParsers(): void {
  if (installed) return
  installed = true
  pg.types.setTypeParser(BIGINT_OID, String)
  pg.types.setTypeParser(DATE_OID, (val) => val)
  pg.types.setTypeParser(NUMERIC_OID, (val) => Number.parseFloat(val))
  pg.types.setTypeParser(TIMESTAMP_OID, (val) => new Date(`${val}Z`))
  pg.types.setTypeParser(TIMESTAMPTZ_OID, (val) => new Date(val))
}

export function resetPgTypeParsersForTest(): void {
  installed = false
}
