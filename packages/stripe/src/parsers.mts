import type Stripe from 'stripe'

export type StripePage<T> = {
  items: T[]
  hasMore: boolean
  nextCursor: string | undefined
}

/**
 * Converts a Stripe list response into a page with a validated cursor. Throws when Stripe
 * reports more data without a cursor, or a cursor that does not advance. The caller owns
 * the paging loop and its page limit.
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
  | { outcome: 'requires_input' | 'processing' | 'canceled' | 'failed' }

export type StripeVerificationSessionResult = {
  status: string
  verified_outputs?: {
    first_name?: string | null
    last_name?: string | null
    id_number?: string | null
    id_number_type?: string | null
    address?: { country?: string | null } | null
  } | null
  last_verification_report?: {
    document?: {
      type?: string | null
      issuing_country?: string | null
      number?: { value?: string | null } | null
      first_name?: { value?: string | null } | null
      last_name?: { value?: string | null } | null
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
  const outputs = session.verified_outputs
  const firstName = outputs?.first_name ?? doc?.first_name?.value ?? null
  const lastName = outputs?.last_name ?? doc?.last_name?.value ?? null
  const fullName =
    firstName && lastName ? `${firstName} ${lastName}` : (firstName ?? lastName ?? null)
  const documentNumber = outputs?.id_number ?? doc?.number?.value ?? null
  const issuingCountry = doc?.issuing_country ?? outputs?.address?.country ?? null
  const documentType = doc?.type ?? outputs?.id_number_type ?? null
  if (!documentNumber || !issuingCountry || !documentType) return { outcome: 'requires_input' }
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

/** True when a Stripe error is a duplicate-lookup-key create race. */
export function isStripeResourceExistsError(error: unknown, param: string): boolean {
  const candidate = error as { type?: unknown; code?: unknown; param?: unknown } | null
  return (
    candidate?.type === 'StripeInvalidRequestError' &&
    candidate.code === 'resource_already_exists' &&
    candidate.param === param
  )
}
