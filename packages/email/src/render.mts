import { render } from '@react-email/render'
import type { ReactElement } from 'react'
import type { EmailRenderResult } from './types.mts'

export type RenderEmailOptions = {
  subject: string
  element: ReactElement
  text: string
  pretty?: boolean
}

/** Renders one React Email element to HTML and pairs it with caller-built subject and text. */
export async function renderEmail(options: RenderEmailOptions): Promise<EmailRenderResult> {
  const html = await render(options.element, { pretty: options.pretty ?? true })
  return { subject: options.subject, html, text: options.text }
}
