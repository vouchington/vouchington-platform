'use client'

import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

function Toaster({ style, ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--color-popover)',
          '--normal-text': 'var(--color-popover-foreground)',
          '--normal-border': 'var(--color-border)',
          '--border-radius': 'var(--radius, 8px)',
          ...style,
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
// Re-exported so the emitter always shares the Sonner instance this Toaster subscribes to.
export { toast } from 'sonner'
