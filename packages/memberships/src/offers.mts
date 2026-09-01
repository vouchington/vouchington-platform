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
  let selected: { offer: Offer; identity: Identity; isPreferred: boolean } | undefined

  for (const offer of offers) {
    if (options.getInterval(offer) !== options.interval) continue
    const isPreferred = options.getCurrency(offer) === options.preferredCurrency
    if (selected === undefined || (isPreferred && !selected.isPreferred)) {
      selected = { offer, identity: options.getIdentity(offer), isPreferred }
      continue
    }
    if (isPreferred === selected.isPreferred) {
      const identity = options.getIdentity(offer)
      if (options.compareIdentity(identity, selected.identity) > 0) {
        selected = { offer, identity, isPreferred }
      }
    }
  }

  return selected?.offer
}

/** Groups offers by a caller-defined canonical product identity without filtering or copying them. */
export function groupMembershipOffersByProduct<Offer, ProductIdentity>(
  offers: readonly Offer[],
  getProductIdentity: (offer: Offer) => ProductIdentity,
): Map<ProductIdentity, Offer[]> {
  const grouped = new Map<ProductIdentity, Offer[]>()
  for (const offer of offers) {
    const identity = getProductIdentity(offer)
    const entries = grouped.get(identity)
    if (entries) entries.push(offer)
    else grouped.set(identity, [offer])
  }
  return grouped
}

/**
 * Keeps one caller-resolved offer per canonical product identity in first-product occurrence order.
 *
 * Without a resolver it preserves the first offer from each product group. A resolver can compose
 * another generic primitive, such as `selectMembershipOffer`, or exclude a product by returning
 * `undefined`.
 */
export function dedupeMembershipOffersByProduct<Offer, ProductIdentity>(
  offers: readonly Offer[],
  getProductIdentity: (offer: Offer) => ProductIdentity,
  resolveProductOffers: (offers: readonly Offer[]) => Offer | undefined = (entries) => entries[0],
): Offer[] {
  return [...groupMembershipOffersByProduct(offers, getProductIdentity).values()].flatMap(
    (productOffers) => {
      const offer = resolveProductOffers(productOffers)
      return offer === undefined ? [] : [offer]
    },
  )
}
