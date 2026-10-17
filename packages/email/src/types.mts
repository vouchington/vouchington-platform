import type { ReactElement } from 'react'

export type EmailRenderResult = {
  subject: string
  html: string
  text: string
}

export type EmailRenderResultPromise = Promise<EmailRenderResult>

export type PreviewableEmailComponent<TProps> = ((props: TProps) => ReactElement) & {
  PreviewProps?: TProps
}

export type LocalizedEmailProps = {
  uiLocale?: string | null
}

export type EmailVars = Readonly<Record<string, string | number>>
export type EmailTranslator = (key: string, vars?: EmailVars) => string

export type EmailColors = Readonly<Record<string, string>> &
  Readonly<{
    background: string
    foreground: string
    card: string
    primary: string
    primaryFg: string
    muted: string
    mutedFg: string
    border: string
  }>
