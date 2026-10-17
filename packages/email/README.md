# @vouchington/email

Pure building blocks for React Email applications. Templates, copy catalogs, brand colors, and
locale lists stay in the application and are injected.

`react`, `react-email`, and `@react-email/render` are peer dependencies.

## API

- `createEmailStyles({ colors, borderRadius?, fontFamily? })` builds the shared inline styles from
  caller-owned brand tokens. `copyrightYear(now?)` returns the year string.
- `emailMessagesFromCatalog(catalog)` and `loadEmailCatalogMessages(directory)` turn
  `@vouchington/localization` catalog tables (or a `copies.json`, `aliases.json`,
  `translations/<locale>.json` directory) into `email` consumer messages.
- `leavesFromCatalog(messages, locale)` resolves messages for one locale with `en-US` fallback.
  Applications may instead supply leaves from any other source, such as a SQLite batch.
- `createEmailTranslator(leaves, locale, family)` returns a `(key, vars) => string` translator over
  `email.<family>.<key>`. `emailOptional` picks the `.unnamed` variant for empty values.
  `formatLocalizationLeaf` and `interpolate` format string, plural, and select-plural leaves.
- `resolveEmailLocale(requested, supported, fallback)` matches exact tag, then language, then fallback.
- `renderEmail({ subject, element, text, pretty? })` renders HTML and pairs it with the
  caller-built subject and plain text.
- `createEmailBundleOptions({ entry, outfile, external?, minify? })` returns esbuild options as
  data. The application imports esbuild and runs the build.
- React Email components and `render` are re-exported for template authors.

## Example

```ts
const messages = loadEmailCatalogMessages(catalogDirectory)
const leaves = leavesFromCatalog(messages, locale)
const t = createEmailTranslator(leaves, locale, 'welcome')
const result = await renderEmail({ subject: t('preview'), element: <Welcome t={t} />, text })
```

Caching of leaves, SQLite loading, template sequencing, and sending belong to the application.
