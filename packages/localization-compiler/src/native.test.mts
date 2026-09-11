import { describe, expect, it } from 'vitest'
import {
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
})
