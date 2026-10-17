import type { JsonLd, JsonLdContext } from './json-ld.mts'

export function createProfilePageJsonLd(
  ctx: JsonLdContext,
  input: {
    username: string
    displayName?: string | null
    path: string
    identifier: string
    imagePath?: string | null
    dateCreated?: string
    sameAs?: string[]
  },
): JsonLd {
  const mainEntity: JsonLd = {
    '@type': 'Person',
    name: input.displayName || input.username,
    identifier: input.identifier,
    url: ctx.absoluteUrl(input.path),
  }
  if (input.displayName && input.displayName !== input.username) {
    mainEntity.alternateName = input.username
  }
  if (input.imagePath) mainEntity.image = ctx.absoluteUrl(input.imagePath)
  if (input.sameAs?.length) mainEntity.sameAs = input.sameAs
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: ctx.absoluteUrl(input.path),
    ...(input.dateCreated ? { dateCreated: input.dateCreated } : {}),
    mainEntity,
  }
}

/** Returns the first mapped schema.org type for the slugs, else `fallback`. */
export function resolveSchemaOrgType(
  slugs: readonly string[],
  mapping: Readonly<Record<string, string>>,
  fallback = 'Thing',
): string {
  for (const slug of slugs) {
    const type = Object.hasOwn(mapping, slug) ? mapping[slug] : undefined
    if (type) return type
  }
  return fallback
}
