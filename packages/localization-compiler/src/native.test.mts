import { describe, expect, it } from 'vitest'
import {
  nativeKeyIdentifier,
  nativeLeafVariants,
  renderDotnetDescriptors,
  renderDotnetKeys,
  renderResx,
  renderSwiftDescriptors,
  renderSwiftKeys,
  renderSwiftStrings,
} from './index.mts'

const identifier = (id: string) => id.replaceAll('.', '')

describe('native resource renderers', () => {
  it('expands leaves and renders swift and resx payloads', () => {
    expect(nativeLeafVariants('nav.home', 'Home & "x"')).toEqual([['nav.home', 'Home & "x"']])
    expect(
      nativeLeafVariants('settings.count', {
        kind: 'plural',
        valueParameter: 'count',
        forms: { one: '{count} one', other: '{count} other' },
      }),
    ).toEqual([
      ['settings.count.__plural.one', '{count} one'],
      ['settings.count.__plural.other', '{count} other'],
    ])
    expect(
      nativeLeafVariants('settings.ago', {
        kind: 'select-plural',
        valueParameter: 'value',
        selectParameter: 'unit',
        cases: {
          hour: { one: '1h', other: 'nh' },
          day: { one: '1', other: 'n' },
        },
      }),
    ).toEqual([
      ['settings.ago.__select.day.one', '1'],
      ['settings.ago.__select.day.other', 'n'],
      ['settings.ago.__select.hour.one', '1h'],
      ['settings.ago.__select.hour.other', 'nh'],
    ])
    const strings = renderSwiftStrings([['nav.home', 'Home & "x"\n']])
    expect(strings).toContain('\\"')
    expect(renderResx([['nav.home', 'Home & <x>']])).toContain('&amp;')
    expect(renderSwiftKeys(['nav.home'], identifier)).toContain('navhome')
    expect(renderDotnetKeys(['nav.home'], identifier)).toContain('navhome')
    expect(
      renderSwiftDescriptors(
        [
          ['settings.count', { kind: 'plural', valueParameter: 'count' }],
          [
            'settings.ago',
            { kind: 'select-plural', valueParameter: 'v', selectParameter: 'unit', cases: ['day'] },
          ],
        ],
        identifier,
      ),
    ).toContain('selectPlural')
    expect(
      renderDotnetDescriptors(
        [
          [
            'settings.count',
            { kind: 'plural', valueParameter: 'count', numberParameters: ['count'] },
          ],
          [
            'settings.ago',
            { kind: 'select-plural', valueParameter: 'v', selectParameter: 'unit', cases: ['day'] },
          ],
        ],
        identifier,
      ),
    ).toContain('SelectParameter')
    expect(() =>
      nativeLeafVariants('settings.count', {
        kind: 'plural',
        valueParameter: 'count',
        forms: { other: 'n' },
      }),
    ).toThrow(/one form/)
    expect(() =>
      nativeLeafVariants('settings.ago', {
        kind: 'select-plural',
        valueParameter: 'value',
        selectParameter: 'unit',
        cases: { day: { other: 'n' } },
      }),
    ).toThrow(/one form/)
  })

  it('derives Swift and .NET identifiers and supports custom headers, namespaces, All, and kindEnum', () => {
    expect(nativeKeyIdentifier('nav.myHome-page_1', 'swift')).toBe('navMyHomePage1')
    expect(nativeKeyIdentifier('nav.myHome-page_1', 'dotnet')).toBe('NavMyHomePage1')
    expect(nativeKeyIdentifier('select-plural', 'swift')).toBe('selectPlural')
    expect(nativeKeyIdentifier('select-plural', 'dotnet')).toBe('SelectPlural')

    expect(renderResx([['nav.quote', "It's <ok>"]])).toContain('It&apos;s &lt;ok&gt;')
    expect(
      renderSwiftStrings([['nav.home', 'Home']], { headerComment: '// Custom Swift' }),
    ).toMatch(/^\/\/ Custom Swift\n/)
    expect(
      renderSwiftKeys(['nav.home'], (id) => nativeKeyIdentifier(id, 'swift'), {
        headerComment: '// Custom Keys',
      }),
    ).toMatch(/^\/\/ Custom Keys\n/)
    const dotnetKeys = renderDotnetKeys(['nav.home'], (id) => nativeKeyIdentifier(id, 'dotnet'), {
      headerComment: '// Custom .NET',
      namespace: 'Acme.Client.Localization',
      includeAll: true,
    })
    expect(dotnetKeys).toContain('namespace Acme.Client.Localization;')
    expect(dotnetKeys).toContain('public static IReadOnlyList<UiMessageKey> All { get; }')
    expect(dotnetKeys).toContain('NavHome,')

    expect(
      renderSwiftDescriptors(
        [['settings.count', { kind: 'plural', valueParameter: 'count' }]],
        (id) => nativeKeyIdentifier(id, 'swift'),
        { headerComment: '// Custom Swift Descriptors' },
      ),
    ).toMatch(/^\/\/ Custom Swift Descriptors\n/)

    const dotnetDescriptors = renderDotnetDescriptors(
      [
        ['settings.count', { kind: 'plural', valueParameter: 'count' }],
        [
          'settings.ago',
          { kind: 'select-plural', valueParameter: 'v', selectParameter: 'unit', cases: ['day'] },
        ],
      ],
      (id) => nativeKeyIdentifier(id, 'dotnet'),
      {
        headerComment: '// Custom .NET Descriptors',
        namespace: 'Acme.Client.Localization',
        kindEnum: true,
      },
    )
    expect(dotnetDescriptors).toContain('namespace Acme.Client.Localization;')
    expect(dotnetDescriptors).toContain(
      'public enum UiMessageDescriptorKind { Plural, SelectPlural }',
    )
    expect(dotnetDescriptors).toContain('UiMessageDescriptorKind.Plural')
    expect(dotnetDescriptors).toContain('UiMessageDescriptorKind.SelectPlural')
  })
})
