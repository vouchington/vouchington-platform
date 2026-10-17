import { aliasEnglishLocale, type LocalizationLeaf } from '@vouchington/localization'
import type { EmailVars } from './types.mts'

const PLACEHOLDER = /\{([\w.-]+)\}/g
const pluralRules = new Map<string, Intl.PluralRules>()

/** Replaces `{name}` placeholders; unknown placeholders are left intact. */
export function interpolate(template: string, vars: EmailVars): string {
  return template.replaceAll(PLACEHOLDER, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

function pluralRule(locale: string): Intl.PluralRules {
  const existing = pluralRules.get(locale)
  if (existing) return existing
  const created = new Intl.PluralRules(locale)
  pluralRules.set(locale, created)
  return created
}

/** Formats a string, plural, or select-plural localization leaf. */
export function formatLocalizationLeaf(
  leaf: LocalizationLeaf,
  locale: string,
  vars: EmailVars = {},
): string {
  if (typeof leaf === 'string') return interpolate(leaf, vars)
  const count = Number(vars[leaf.valueParameter])
  if (!Number.isFinite(count)) {
    throw new TypeError(`Message requires numeric "${leaf.valueParameter}"`)
  }
  const category = pluralRule(aliasEnglishLocale(locale)).select(count)
  const merged = { ...vars, [leaf.valueParameter]: count }
  if (leaf.kind === 'plural') {
    return interpolate(leaf.forms[category] ?? leaf.forms.other, merged)
  }
  const selection = String(vars[leaf.selectParameter] ?? '')
  const forms = leaf.cases[selection]
  if (forms === undefined) throw new TypeError(`Message has no case "${selection}"`)
  return interpolate(forms[category] ?? forms.other, merged)
}
