export interface ChunkOptions<T> {
  maxItems: number
  maxBytes: number
  sizeOf: (item: T) => number
}

// Splits items into ordered chunks bounded by count and total byte size. A single item larger
// than maxBytes can never be sent, so it throws instead of producing an unsendable chunk.
export function chunkBySize<T>(items: readonly T[], options: ChunkOptions<T>): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let bytes = 0
  for (const item of items) {
    const size = options.sizeOf(item)
    if (size > options.maxBytes) {
      throw new RangeError(`Item of ${size} bytes exceeds the ${options.maxBytes} byte limit`)
    }
    const full = current.length >= options.maxItems || bytes + size > options.maxBytes
    if (current.length > 0 && full) {
      chunks.push(current)
      current = []
      bytes = 0
    }
    current.push(item)
    bytes += size
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export function byteLength(value: string | Uint8Array): number {
  return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : value.byteLength
}
