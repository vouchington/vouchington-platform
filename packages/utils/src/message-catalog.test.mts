import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  createMessageTranslator,
  isCatalogRecord,
  isMessageDescriptor,
  plural,
  selectPlural,
  type MessageCatalog,
  type MessageKey,
} from './message-catalog.mts'

const catalog = {
  nav: { greeting: 'Hello, {name}!', missing: 'Value: {value}' },
  counts: {
    items: plural('count', { one: '{count} item', few: '{count} items', other: '{count} items' }, [
      'count',
    ]),
    gendered: selectPlural('count', 'gender', {
      female: { one: '{count} she', other: '{count} she' },
    }),
  },
} as const satisfies MessageCatalog

function assertLiteralCatalogTypes(): void {
  // @ts-expect-error Dots delimit nested catalog segments and cannot appear in a segment.
  createMessageTranslator('en', { 'bad.key': 'nope' } as const)
}
void assertLiteralCatalogTypes

describe('message catalogs', () => {
  it('translates typed nested string leaves and interpolates parameters', () => {
    const translate = createMessageTranslator('en', catalog)
    expect(translate('nav.greeting', { name: 'Ava' })).toBe('Hello, Ava!')
    expect(translate('nav.missing')).toBe('Value: {value}')
    expect(
      createMessageTranslator('en', { label: '{user-name} from {profile.name}' })('label', {
        'user-name': 'Ava',
        'profile.name': 'Operations',
      }),
    ).toBe('Ava from Operations')
    expectTypeOf(translate)
      .parameter(0)
      .toEqualTypeOf<'nav.greeting' | 'nav.missing' | 'counts.items' | 'counts.gendered'>()
    expectTypeOf<MessageKey<typeof catalog>>().toEqualTypeOf<
      'nav.greeting' | 'nav.missing' | 'counts.items' | 'counts.gendered'
    >()
    const annotated: MessageCatalog = { title: 'Title' }
    expectTypeOf(createMessageTranslator('en', annotated)).parameter(0).toEqualTypeOf<string>()
  })
  it('resolves every plural category with other fallback and injected formatting', () => {
    const translate = createMessageTranslator(
      'ar',
      {
        item: plural(
          'count',
          { zero: 'zero', one: 'one', two: 'two', few: 'few', many: 'many', other: 'other' },
          ['count'],
        ),
      },
      { formatNumber: (value) => `#${value}` },
    )
    expect([0, 1, 2, 3, 11].map((count) => translate('item', { count }))).toEqual([
      'zero',
      'one',
      'two',
      'few',
      'many',
    ])
    expect(createMessageTranslator('en', catalog)('counts.items', { count: 2 })).toBe('2 items')
    expect(
      createMessageTranslator('en', catalog, { formatNumber: (value) => `N:${value}` })(
        'counts.items',
        { count: 2 },
      ),
    ).toBe('N:2 items')
    expect(() => translate('item', {})).toThrow('finite number')
    expect(() => translate('item', { count: Number.POSITIVE_INFINITY })).toThrow('finite number')
    expect(() => translate('item', { count: '2' })).toThrow('finite number')
  })
  it('resolves select plurals and reports invalid cases and paths', () => {
    const translate = createMessageTranslator('en', catalog)
    expect(translate('counts.gendered', { count: 1, gender: 'female' })).toBe('1 she')
    expect(() => translate('counts.gendered', { count: 1, gender: 'other' })).toThrow(
      'Unknown select-plural',
    )
    expect(() => (translate as (key: string) => string)('missing.path')).toThrow('Unresolvable')
    expect(() => (translate as (key: string) => string)('nav')).toThrow('non-leaf')
    const undefinedCase = createMessageTranslator('en', {
      item: selectPlural('count', 'kind', { undefined: { other: 'wrong' } }),
    })
    expect(() => undefinedCase('item', { count: 1 })).toThrow('"kind" must be present')
    const inheritedSelector = Object.create({ kind: 'undefined' }) as Record<string, unknown>
    inheritedSelector.count = 1
    expect(() => undefinedCase('item', inheritedSelector)).toThrow('"kind" must be present')
  })
  it('only accepts serializable descriptors', () => {
    expect(isMessageDescriptor(plural('count', { other: '{count}' }))).toBe(true)
    expect(() => plural('count', { custom: 'items' } as never)).toThrow('Invalid plural')
    expect(() =>
      selectPlural('count', 'kind', { other: { other: 'items' } }, ['count']),
    ).not.toThrow()
    const sparseParameters = ['count'] as string[]
    sparseParameters.length = 2
    expect(
      isMessageDescriptor({
        kind: 'plural',
        valueParameter: 'count',
        numberParameters: sparseParameters,
        forms: { other: 'items' },
      }),
    ).toBe(false)
    expect(() => plural('count', { other: 'items' }, sparseParameters)).toThrow('Invalid plural')
    expect(
      isMessageDescriptor({
        kind: 'plural',
        valueParameter: 'count',
        forms: { other: 'items' },
        extra: 123n,
      }),
    ).toBe(false)
    const cyclicExtra = {} as Record<string, unknown>
    cyclicExtra.self = cyclicExtra
    expect(
      isMessageDescriptor({
        kind: 'select-plural',
        valueParameter: 'count',
        selectParameter: 'kind',
        cases: { other: { other: 'items' } },
        extra: cyclicExtra,
      }),
    ).toBe(false)
    expect(() =>
      createMessageTranslator('en', {
        bad: {
          kind: 'plural',
          valueParameter: 'count',
          forms: { other: 'items' },
          extra: 123n,
        },
      } as unknown as MessageCatalog),
    ).toThrow('Invalid plural')
    expect(
      isMessageDescriptor({ kind: 'plural', valueParameter: 'count', forms: { other: () => '' } }),
    ).toBe(false)
    expect(
      isMessageDescriptor({
        kind: 'plural',
        valueParameter: 'count',
        forms: { other: 'items', custom: 'invalid' },
      }),
    ).toBe(false)
    expect(
      isMessageDescriptor({
        kind: 'select-plural',
        valueParameter: 'count',
        selectParameter: 'kind',
        cases: Object.create({ other: { other: 'items' } }),
      }),
    ).toBe(false)
    expect(
      isMessageDescriptor({
        kind: 'plural',
        valueParameter: 'count',
        forms: { other: 'items' },
        toJSON: () => ({ kind: 'plural' }),
      }),
    ).toBe(false)
    expect(JSON.stringify(catalog)).not.toContain('function')
  })
  it('rejects prototype select cases and dot-containing catalog segments', () => {
    const inheritedCases = Object.create({ female: { other: 'items' } }) as Record<string, unknown>
    expect(() => selectPlural('count', 'gender', inheritedCases as never)).toThrow()
    expect(() =>
      createMessageTranslator('en', { 'bad.key': 'nope' } as unknown as MessageCatalog),
    ).toThrow('must not contain a dot')
    expect(() =>
      createMessageTranslator('en', {
        bad: { kind: 'plural', valueParameter: 'count', forms: { other: () => 'items' } },
      } as unknown as MessageCatalog),
    ).toThrow('Invalid plural')
    expect(() =>
      createMessageTranslator('en', {
        bad: {
          kind: 'select-plural',
          valueParameter: 'count',
          selectParameter: 'kind',
          cases: { other: {} },
        },
      } as unknown as MessageCatalog),
    ).toThrow('Invalid select-plural')
    expect(() => createMessageTranslator('en', null as unknown as MessageCatalog)).toThrow(
      'serializable catalog',
    )
    const nestedKind = createMessageTranslator('en', {
      section: { kind: 'plural', title: 'Plural' },
    })
    expect(nestedKind('section.kind')).toBe('plural')
    const nonEnumerableCatalog = {} as Record<string, unknown>
    Object.defineProperty(nonEnumerableCatalog, 'title', { value: 'Title', enumerable: false })
    expect(() => createMessageTranslator('en', nonEnumerableCatalog as MessageCatalog)).toThrow(
      'serializable catalog',
    )
  })
  it('falls back to other for a valid category that has no dedicated form', () => {
    expect(
      createMessageTranslator('en', { item: plural('count', { other: 'items' }) })('item', {
        count: 1,
      }),
    ).toBe('items')
    const forms = { other: 'own fallback' }
    const translate = createMessageTranslator('en', { item: plural('count', forms) })
    const priorOne = Object.getOwnPropertyDescriptor(Object.prototype, 'one')
    Object.defineProperty(Object.prototype, 'one', {
      configurable: true,
      value: 'inherited value',
    })
    try {
      expect(translate('item', { count: 1 })).toBe('own fallback')
    } finally {
      if (priorOne) Object.defineProperty(Object.prototype, 'one', priorOne)
      else Reflect.deleteProperty(Object.prototype, 'one')
    }
  })
  it('rejects cycles and hostile proxies without rejecting shared acyclic catalog nodes', () => {
    const cyclic = {} as Record<string, unknown>
    cyclic.self = cyclic
    expect(() => createMessageTranslator('en', cyclic as MessageCatalog)).toThrow('catalog cycle')

    const shared = { title: 'Title' }
    const translate = createMessageTranslator('en', { first: shared, second: shared })
    expect(translate('first.title')).toBe('Title')
    expect(translate('second.title')).toBe('Title')

    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('proxy trap')
        },
      },
    )
    expect(isCatalogRecord(hostile)).toBe(false)
    expect(isMessageDescriptor(hostile)).toBe(false)
    expect(() => createMessageTranslator('en', hostile as MessageCatalog)).toThrow(
      'serializable catalog',
    )

    const descriptorTrap = new Proxy(
      { kind: 'plural', valueParameter: 'count', forms: { other: 'items' } },
      {
        get: () => {
          throw new Error('descriptor proxy trap')
        },
      },
    )
    expect(isMessageDescriptor(descriptorTrap)).toBe(false)
    const readTrap = new Proxy(
      { title: 'Title' },
      {
        get: () => {
          throw new Error('catalog proxy trap')
        },
      },
    )
    expect(() => createMessageTranslator('en', readTrap as MessageCatalog)).toThrow(
      'serializable catalog',
    )
  })
})
