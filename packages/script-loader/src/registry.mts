type ScriptRecord = { status: 'loading' | 'ready' } | { status: 'error'; errorAt: number }

export const records = new Map<string, ScriptRecord>()
export const listeners = new Map<string, Set<() => void>>()
