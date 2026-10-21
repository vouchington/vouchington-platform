import { listeners, records } from './registry.mts'

/** Clears the shared script state so each test starts with no loaded or failed scripts. */
export function resetScriptLoaderForTests(): void {
  records.clear()
  listeners.clear()
}
