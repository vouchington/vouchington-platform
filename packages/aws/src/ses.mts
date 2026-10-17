import {
  SendEmailCommand,
  SendRawEmailCommand,
  type Body,
  type SendEmailCommandInput,
} from '@aws-sdk/client-ses'
import { AWS_DUALSTACK_CLIENT_CONFIG } from './request-handler.mts'
import { buildRawEmailMessage, type RawEmailOptions } from './ses-mime.mts'

export { buildRawEmailMessage }

// SES sends carry no idempotency token, so an SDK retry after an ambiguous timeout can deliver
// twice. Spread this into the SESClient options; retries then become the caller's decision.
export const SES_CLIENT_CONFIG = { ...AWS_DUALSTACK_CLIENT_CONFIG, maxAttempts: 1 } as const

export interface SesEmail extends RawEmailOptions {
  bcc?: readonly string[] | undefined
  configurationSetName?: string | undefined
}

function toList(value: string | readonly string[]): string[] {
  return typeof value === 'string' ? [value] : [...value]
}

// Builds a SendRawEmail command. Both To and Bcc are envelope destinations.
export function buildSendRawEmailCommand(email: SesEmail): SendRawEmailCommand {
  return new SendRawEmailCommand({
    RawMessage: { Data: Buffer.from(buildRawEmailMessage(email), 'utf8') },
    Destinations: [...toList(email.to), ...(email.bcc ?? [])],
    Source: email.source,
    ...(email.configurationSetName ? { ConfigurationSetName: email.configurationSetName } : {}),
  })
}

// Builds a structured SendEmail command (no custom headers).
export function buildSendEmailCommand(email: SesEmail): SendEmailCommand {
  const Body: Body = {}
  if (email.text) Body.Text = { Charset: 'UTF-8', Data: email.text }
  if (email.html) Body.Html = { Charset: 'UTF-8', Data: email.html }
  const input: SendEmailCommandInput = {
    Destination: { BccAddresses: [...(email.bcc ?? [])], ToAddresses: toList(email.to) },
    Source: email.source,
    Message: { Subject: { Charset: 'UTF-8', Data: email.subject }, Body },
    ...(email.replyTo ? { ReplyToAddresses: toList(email.replyTo) } : {}),
    ...(email.configurationSetName ? { ConfigurationSetName: email.configurationSetName } : {}),
  }
  return new SendEmailCommand(input)
}

// Picks SendRawEmail when custom headers are present (SendEmail cannot carry them).
export function buildEmailCommand(email: SesEmail): SendEmailCommand | SendRawEmailCommand {
  return Object.keys(email.headers ?? {}).length > 0
    ? buildSendRawEmailCommand(email)
    : buildSendEmailCommand(email)
}
