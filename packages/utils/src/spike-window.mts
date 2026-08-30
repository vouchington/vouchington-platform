interface SpikeWindow {
  count: number
  windowStart: number
}

export interface SpikeWindowTracker {
  readonly size: number
  recordAndCheck(fingerprint: string, timestamp: number): boolean
}

/** Tracks per-fingerprint occurrence counts while evicting expired windows. */
export function createSpikeWindowTracker(limit: number, windowMs: number): SpikeWindowTracker {
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new RangeError('limit must be a non-negative safe integer')
  if (!Number.isFinite(windowMs) || windowMs <= 0)
    throw new RangeError('windowMs must be positive and finite')
  const windows = new Map<string, SpikeWindow>()
  let lastSweepAt = -Infinity
  let lastTimestamp = -Infinity

  function sweepExpiredWindows(timestamp: number): void {
    if (timestamp - lastSweepAt < windowMs) return
    lastSweepAt = timestamp
    for (const [fingerprint, window] of windows) {
      if (timestamp - window.windowStart >= windowMs) windows.delete(fingerprint)
    }
  }

  return {
    get size() {
      return windows.size
    },
    recordAndCheck(fingerprint, timestamp) {
      if (!Number.isFinite(timestamp)) throw new RangeError('timestamp must be finite')
      if (timestamp < lastTimestamp) {
        windows.clear()
        lastSweepAt = timestamp
      }
      lastTimestamp = timestamp
      sweepExpiredWindows(timestamp)
      const existing = windows.get(fingerprint)
      const window =
        existing && timestamp - existing.windowStart < windowMs
          ? existing
          : { count: 0, windowStart: timestamp }
      window.count += 1
      windows.set(fingerprint, window)
      return window.count <= limit
    },
  }
}
