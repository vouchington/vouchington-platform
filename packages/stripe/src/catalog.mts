import type Stripe from 'stripe'

export type RecurringCatalogDescriptor = {
  lookupKey: string
  productName: string
  unitAmount: number
  interval: 'month' | 'year'
  currency: string
  /** Product metadata that must be present verbatim, e.g. a catalog version and lookup key. */
  productMetadata: Record<string, string>
}

/** Params that create the descriptor's price and product. */
export function buildRecurringCatalogPriceParams(
  descriptor: RecurringCatalogDescriptor,
): Stripe.PriceCreateParams {
  return {
    currency: descriptor.currency,
    unit_amount: descriptor.unitAmount,
    recurring: { interval: descriptor.interval, interval_count: 1 },
    lookup_key: descriptor.lookupKey,
    product_data: { name: descriptor.productName, metadata: descriptor.productMetadata },
  }
}

/** Params that list prices for a lookup key, expanding the product. Fetch at most two. */
export function buildCatalogPriceLookupParams(lookupKey: string): Stripe.PriceListParams {
  return { lookup_keys: [lookupKey], expand: ['data.product'], limit: 2 }
}

/** Returns the single listed price, null when none, and throws when the key is ambiguous. */
export function pickCatalogPrice(
  listed: readonly Stripe.Price[],
  lookupKey: string,
): Stripe.Price | null {
  if (listed.length > 1)
    throw new Error(`Stripe catalog lookup key ${lookupKey} resolves to multiple prices`)
  return listed[0] ?? null
}

/**
 * Checks that a price and its product match the descriptor exactly. `product` must be the
 * expanded or retrieved product.
 */
export function validateRecurringCatalogPrice(
  price: Stripe.Price,
  product: Stripe.Product | Stripe.DeletedProduct | null,
  expected: RecurringCatalogDescriptor,
): Stripe.Price {
  if (!product || product.deleted || !price.active || !product.active)
    throw new Error(
      `Stripe catalog price ${expected.lookupKey} is inactive; create a new catalog version`,
    )
  const metadataMatches = Object.entries(expected.productMetadata).every(
    ([key, value]) => product.metadata[key] === value,
  )
  if (
    price.lookup_key !== expected.lookupKey ||
    price.currency !== expected.currency ||
    price.unit_amount !== expected.unitAmount ||
    price.recurring?.interval !== expected.interval ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== 'licensed' ||
    price.billing_scheme !== 'per_unit' ||
    price.transform_quantity !== null ||
    product.name !== expected.productName ||
    !metadataMatches
  )
    throw new Error(
      `Stripe catalog price ${expected.lookupKey} does not match the immutable descriptor`,
    )
  return price
}
