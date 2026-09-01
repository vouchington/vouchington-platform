export type MembershipOfferSelectionOptions<Offer, Interval, Currency, Identity> = {
  interval: Interval
  preferredCurrency: Currency
  getInterval: (offer: Offer) => Interval
  getCurrency: (offer: Offer) => Currency
  getIdentity: (offer: Offer) => Identity
  compareIdentity: (left: Identity, right: Identity) => number
}

/**
 * Selects an offer for an interval, preferring the requested currency when it exists.
 *
 * The greatest caller-defined identity wins within the selected currency set. Equal identities
 * retain the first offer, so callers can provide a stable input order when identities collide.
 */
export function selectMembershipOffer<Offer, Interval, Currency, Identity>(
  offers: readonly Offer[],
  options: MembershipOfferSelectionOptions<Offer, Interval, Currency, Identity>,
): Offer | undefined {
  let selected: Offer | undefined
  let selectedIsPreferred = false

  for (const offer of offers) {
    if (options.getInterval(offer) !== options.interval) continue
    const isPreferred = options.getCurrency(offer) === options.preferredCurrency
    if (
      selected === undefined ||
      (isPreferred && !selectedIsPreferred) ||
      (isPreferred === selectedIsPreferred &&
        options.compareIdentity(options.getIdentity(offer), options.getIdentity(selected)) > 0)
    ) {
      selected = offer
      selectedIsPreferred = isPreferred
    }
  }

  return selected
}

/** Preserves the first offer for each caller-defined canonical product identity. */
export function dedupeMembershipOffersByProduct<Offer, ProductIdentity>(
  offers: readonly Offer[],
  getProductIdentity: (offer: Offer) => ProductIdentity,
): Offer[] {
  const identities = new Set<ProductIdentity>()
  return offers.filter((offer) => {
    const identity = getProductIdentity(offer)
    if (identities.has(identity)) return false
    identities.add(identity)
    return true
  })
}
