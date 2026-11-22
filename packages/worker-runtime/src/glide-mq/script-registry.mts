/** A native script handle that can be released. */
export interface ReleasableScript {
  release(): void
}

export interface ScriptRegistry<S extends ReleasableScript> {
  /** Creates one script through the injected factory and tracks it for release. */
  register(code: string): S
  /** Releases every tracked script. Safe to call more than once. */
  releaseAll(): void
}

/**
 * Tracks native scripts so their handles are released at process exit. The factory (for example
 * `(code) => new Script(code)` from the GlideMQ client library) stays with the application, which
 * keeps this package free of a native dependency. The `exit` hook is installed on first use.
 */
export function createScriptRegistry<S extends ReleasableScript>(
  createScript: (code: string) => S,
  processLike: Pick<NodeJS.Process, 'once'> = process,
): ScriptRegistry<S> {
  const scripts: S[] = []
  let hooked = false
  const releaseAll = () => {
    for (const script of scripts.splice(0)) script.release()
  }
  return {
    register(code) {
      if (!hooked) {
        hooked = true
        processLike.once('exit', releaseAll)
      }
      const script = createScript(code)
      scripts.push(script)
      return script
    },
    releaseAll,
  }
}
