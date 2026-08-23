declare module 'sql-template-strings' {
  export class SQLStatement {
    text: string
    sql: string
    values: unknown[]
    name?: string
    append(statement: SQLStatement | string | number): this
    setName(name: string): this
  }

  function sql(strings: TemplateStringsArray, ...values: unknown[]): SQLStatement
  export default sql
}
