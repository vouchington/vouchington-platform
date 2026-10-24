export type TestWorkerProcessorDecorator = (processor: unknown, queueName: string) => unknown

// Stored on globalThis rather than in module state so the slot survives `vi.resetModules()`:
// setup files are not re-run, but application factory modules are, and later workers must keep
// the decorator. This module imports neither vitest nor `glide-mq/testing`, so the production
// runtime can read it without loading the testing entry.
const DECORATOR_KEY = Symbol.for('@vouchington/worker-runtime.testWorkerProcessorDecorator')
const decoratorGlobal = globalThis as typeof globalThis & {
  [DECORATOR_KEY]?: TestWorkerProcessorDecorator | undefined
}

/** Installs (or, with `undefined`, clears) a decorator applied to every runtime-built worker. */
export function setTestWorkerProcessorDecorator(
  decorator: TestWorkerProcessorDecorator | undefined,
): void {
  decoratorGlobal[DECORATOR_KEY] = decorator
}

export function getTestWorkerProcessorDecorator(): TestWorkerProcessorDecorator | undefined {
  return decoratorGlobal[DECORATOR_KEY]
}
