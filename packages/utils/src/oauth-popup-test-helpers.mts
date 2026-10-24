import type { OAuthPopupMessageEvent, OAuthPopupWindow } from './oauth-popup.mts'

export function makeFakeWindow(options: { blocked?: boolean; origin?: string } = {}) {
  const popup = { closed: false }
  const listeners = new Set<(event: OAuthPopupMessageEvent) => void>()
  const intervals = new Map<number, () => void>()
  let nextId = 1
  const opened: Array<{ url: string; name: string; features: string }> = []
  const win: OAuthPopupWindow = {
    location: { origin: options.origin ?? 'https://app.example.com' },
    open(url, name, features) {
      opened.push({ url, name, features })
      return options.blocked ? null : popup
    },
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    setInterval(callback) {
      const id = nextId++
      intervals.set(id, callback)
      return id
    },
    clearInterval: (id) => void intervals.delete(id),
  }
  return {
    win,
    popup,
    opened,
    listenerCount: () => listeners.size,
    intervalCount: () => intervals.size,
    tick: () => intervals.forEach((callback) => callback()),
    post(event: Partial<OAuthPopupMessageEvent>) {
      const full = { origin: win.location.origin, source: popup, data: null, ...event }
      listeners.forEach((listener) => listener(full))
    },
  }
}
