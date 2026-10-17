export type {
  EmailColors,
  EmailRenderResult,
  EmailRenderResultPromise,
  EmailTranslator,
  EmailVars,
  LocalizedEmailProps,
  PreviewableEmailComponent,
} from './types.mts'
export {
  DEFAULT_EMAIL_FONT_FAMILY,
  copyrightYear,
  createEmailStyles,
  type EmailStyleOptions,
  type EmailStyles,
} from './styles.mts'
export { formatLocalizationLeaf, interpolate } from './format.mts'
export {
  createEmailTranslator,
  emailOptional,
  leavesFromCatalog,
  type EmailLeaves,
} from './copy.mts'
export { emailMessagesFromCatalog, loadEmailCatalogMessages } from './catalog-json.mts'
export { resolveEmailLocale } from './locale.mts'
export { renderEmail, type RenderEmailOptions } from './render.mts'
export { createEmailBundleOptions, type EmailBundleOptions } from './bundle.mts'
export {
  Body,
  Button,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
  render,
} from './runtime.mts'
