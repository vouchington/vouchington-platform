import type { AdmissionStorage } from './admission-storage.mts'

export class MemoryStorage implements AdmissionStorage {
  readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }
}

export class MemoryLockManager {
  readonly #tails = new Map<string, Promise<void>>()
  readonly requestedNames: string[] = []

  async request<T>(name: string, callback: () => Promise<T> | T): Promise<T> {
    this.requestedNames.push(name)
    const previous = this.#tails.get(name) ?? Promise.resolve()
    let release!: () => void
    const tail = new Promise<void>((resolve) => {
      release = resolve
    })
    this.#tails.set(name, tail)
    await previous
    try {
      return await callback()
    } finally {
      release()
      if (this.#tails.get(name) === tail) this.#tails.delete(name)
    }
  }
}
