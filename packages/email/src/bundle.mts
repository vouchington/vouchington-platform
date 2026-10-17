export type EmailBundleOptions = {
  entry: string
  outfile: string
  /** Packages left out of the bundle; the application's localization packages by default. */
  external?: readonly string[]
  minify?: boolean
}

/**
 * Returns esbuild options for bundling a templates entry (React Email, React and React DOM
 * included) into one ESM file. Pure data: the application imports esbuild and runs the build.
 */
export function createEmailBundleOptions(options: EmailBundleOptions) {
  return {
    entryPoints: [options.entry],
    outfile: options.outfile,
    format: 'esm' as const,
    platform: 'node' as const,
    target: 'esnext',
    jsx: 'automatic' as const,
    jsxImportSource: 'react',
    bundle: true,
    external: [...(options.external ?? ['@vouchington/localization'])],
    banner: {
      js: "import { createRequire } from 'node:module';const require = createRequire(import.meta.url);",
    },
    minify: options.minify ?? true,
    logLevel: 'info' as const,
  }
}
