export class WikimediaHttpError extends Error {
  readonly status: number
  readonly url: string

  constructor(status: number, url: string) {
    super(`Wikimedia request failed with status ${status}`)
    this.name = 'WikimediaHttpError'
    this.status = status
    this.url = url
  }
}

export class WikimediaDecodeError extends Error {
  readonly url: string

  constructor(url: string) {
    super('Wikimedia response did not match the expected shape')
    this.name = 'WikimediaDecodeError'
    this.url = url
  }
}
