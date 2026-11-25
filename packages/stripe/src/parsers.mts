import type Stripe from 'stripe'
import { getStripeObjectId } from './event-utils.mts'

export type StripePage<T> = {
  items: T[]
  hasMore: boolean
  nextCursor: string | undefined
}

/**
 * Converts a Stripe list response into a page with a validated cursor. Throws when Stripe
 * reports more data without a cursor, or a cursor that does not advance.
 */
export function parseStripePage<T extends { id: string }>(
  page: Pick<Stripe.ApiList<T>, 'data' | 'has_more'>,
  startingAfter?: string,
  label = 'item',
): StripePage<T> {
  if (!page.has_more) return { items: page.data, hasMore: false, nextCursor: undefined }
  const last = page.data.at(-1)
  if (!last?.id) throw new Error(`Stripe returned has_more without a ${label} cursor`)
  if (last.id === startingAfter)
    throw new Error(`Stripe returned has_more without advancing the ${label} cursor`)
  return { items: page.data, hasMore: true, nextCursor: last.id }
}

export type CollectStripePagesOptions<T extends { id: string }> = {
  fetchPage: (
    startingAfter: string | undefined,
  ) => Promise<Pick<Stripe.ApiList<T>, 'data' | 'has_more'>>
  maxPages: number
  label?: string
}

/**
 * Collects every page from a cursor-paginated Stripe list up to `maxPages`.
 * Validates each page with `parseStripePage` and throws when the page limit is exceeded.
 */
export async function collectStripePages<T extends { id: string }>(
  options: CollectStripePagesOptions<T>,
): Promise<T[]> {
  if (!(Number.isInteger(options.maxPages) && options.maxPages > 0))
    throw new RangeError('maxPages must be a positive integer')
  const label = options.label ?? 'item'
  const collected: T[] = []
  let startingAfter: string | undefined
  for (let pageCount = 0; pageCount < options.maxPages; pageCount++) {
    const page = await options.fetchPage(startingAfter)
    const parsed = parseStripePage(page, startingAfter, label)
    collected.push(...parsed.items)
    if (!parsed.hasMore) return collected
    startingAfter = parsed.nextCursor
  }
  throw new Error(`Stripe ${label} listing exceeded the page limit (${options.maxPages})`)
}

export type StripeInvoicePaymentLike = {
  type?: string | null | undefined
  charge?: string | { id: string } | null | undefined
  payment_intent?: string | { id: string } | null | undefined
}

export type StripeInvoicePaymentTarget = {
  type: string
  chargeId: string | null
  paymentIntentId: string | null
}

/** Extracts the payment type and charge or payment-intent id from an InvoicePayment's `payment` field. */
export function parseStripeInvoicePaymentTarget(
  payment: StripeInvoicePaymentLike | null | undefined,
): StripeInvoicePaymentTarget {
  const type = payment?.type ?? ''
  return {
    type,
    chargeId: type === 'charge' ? getStripeObjectId(payment?.charge) : null,
    paymentIntentId: type === 'payment_intent' ? getStripeObjectId(payment?.payment_intent) : null,
  }
}

export type VerificationResult =
  | {
      outcome: 'verified'
      firstName: string | null
      lastName: string | null
      fullName: string | null
      documentNumber: string
      issuingCountry: string
      documentType: string
    }
  | {
      outcome: 'verified_id_number'
      firstName: string | null
      lastName: string | null
      fullName: string | null
      idNumber: string
      idNumberType: string
    }
  | { outcome: 'requires_input' | 'processing' | 'canceled' | 'failed' }

/** The subset of a VerificationSession retrieved with IDENTITY_RESULT_EXPAND that is read. */
export type StripeVerificationSessionResult = {
  status: string
  verified_outputs?: {
    first_name?: string | null
    last_name?: string | null
    id_number?: string | null
    id_number_type?: string | null
  } | null
  last_verification_report?: {
    document?: {
      type?: string | null
      issuing_country?: string | null
      number?: string | null
      first_name?: string | null
      last_name?: string | null
    } | null
    id_number?: {
      status?: string | null
      id_number?: string | null
      id_number_type?: string | null
      first_name?: string | null
      last_name?: string | null
    } | null
  } | null
}

/** Interprets an Identity verification session retrieved with IDENTITY_RESULT_EXPAND. */
export function parseVerificationSession(
  session: StripeVerificationSessionResult,
): VerificationResult {
  if (session.status === 'canceled') return { outcome: 'canceled' }
  if (session.status === 'requires_input') return { outcome: 'requires_input' }
  if (session.status === 'processing') return { outcome: 'processing' }
  if (session.status !== 'verified') return { outcome: 'failed' }

  const doc = session.last_verification_report?.document
  const idReport = session.last_verification_report?.id_number
  const outputs = session.verified_outputs
  const idVerified = idReport?.status === 'verified'
  const firstName = outputs?.first_name ?? doc?.first_name ?? idReport?.first_name ?? null
  const lastName = outputs?.last_name ?? doc?.last_name ?? idReport?.last_name ?? null
  const fullName =
    firstName && lastName ? `${firstName} ${lastName}` : (firstName ?? lastName ?? null)
  const documentNumber = doc?.number ?? null
  const issuingCountry = doc?.issuing_country ?? null
  const documentType = doc?.type ?? null
  if (documentNumber && issuingCountry && documentType) {
    return {
      outcome: 'verified',
      firstName,
      lastName,
      fullName,
      documentNumber,
      issuingCountry,
      documentType,
    }
  }
  // id_number sessions have no document; the verified report carries the number instead.
  const idNumber = idVerified ? (idReport.id_number ?? outputs?.id_number ?? null) : null
  const idNumberType = idReport?.id_number_type ?? outputs?.id_number_type ?? null
  if (idNumber && idNumberType) {
    return { outcome: 'verified_id_number', firstName, lastName, fullName, idNumber, idNumberType }
  }
  return { outcome: 'requires_input' }
}

/** True when a Stripe error is a duplicate-lookup-key create race. */
export function isStripeResourceExistsError(error: unknown, param: string): boolean {
  const candidate = error as { type?: unknown; code?: unknown; param?: unknown } | null
  return (
    candidate?.type === 'StripeInvalidRequestError' &&
    candidate.code === 'resource_already_exists' &&
    candidate.param === param
  )
}
