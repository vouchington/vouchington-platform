export class CatalogRowNotFoundError extends TypeError {
  readonly code = 'ERR_CATALOG_ROW_NOT_FOUND'
  readonly id: string
  readonly consumer: string | undefined

  constructor(id: string, consumer: string | undefined, message: string) {
    super(message)
    this.name = 'CatalogRowNotFoundError'
    this.id = id
    this.consumer = consumer
  }
}
