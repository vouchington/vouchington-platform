import type { EmailColors } from './types.mts'

export const DEFAULT_EMAIL_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif'

export type EmailStyleOptions = {
  colors: EmailColors
  borderRadius?: string
  fontFamily?: string
}

/** The calendar year as a string, for copyright footers. */
export function copyrightYear(now: Date = new Date()): string {
  return String(now.getFullYear())
}

/** Builds the shared inline-style objects from caller-supplied brand tokens. */
export function createEmailStyles(options: EmailStyleOptions) {
  const { colors } = options
  const borderRadius = options.borderRadius ?? '6px'
  const fontFamily = options.fontFamily ?? DEFAULT_EMAIL_FONT_FAMILY
  return {
    main: { backgroundColor: colors.background, fontFamily },
    container: {
      backgroundColor: colors.card,
      margin: '0 auto',
      padding: '12px 0 24px',
      marginBottom: '32px',
    },
    section: { padding: '24px' },
    heading: {
      fontSize: '20px',
      fontWeight: 'bold',
      margin: '0 0 16px 0',
      color: colors.foreground,
    },
    paragraph: { fontSize: '14px', lineHeight: '22px', margin: '8px 0', color: colors.foreground },
    listItem: {
      fontSize: '13px',
      lineHeight: '20px',
      margin: '6px 0 6px 16px',
      color: colors.foreground,
    },
    buttonContainer: { textAlign: 'center' as const, margin: '16px 0' },
    button: {
      backgroundColor: colors.primary,
      borderRadius,
      color: colors.primaryFg,
      fontSize: '14px',
      fontWeight: 'bold',
      padding: '10px 20px',
      textDecoration: 'none',
    },
    secondaryButton: {
      backgroundColor: colors.card,
      borderRadius,
      color: colors.primary,
      fontSize: '13px',
      fontWeight: 'bold',
      padding: '8px 16px',
      textDecoration: 'none',
      border: `1px solid ${colors.primary}`,
      display: 'inline-block' as const,
    },
    codeContainer: {
      backgroundColor: colors.muted,
      borderRadius,
      padding: '12px',
      margin: '12px 0',
      textAlign: 'center' as const,
    },
    code: {
      fontSize: '16px',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      color: colors.foreground,
      margin: '0',
      letterSpacing: '2px',
    },
    footer: {
      textAlign: 'center' as const,
      padding: '16px 24px',
      borderTop: `1px solid ${colors.border}`,
      marginTop: '24px',
    },
    footerText: { fontSize: '11px', color: colors.mutedFg, margin: '0' },
  } as const
}

export type EmailStyles = ReturnType<typeof createEmailStyles>
