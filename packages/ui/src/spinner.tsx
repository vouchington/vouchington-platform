import { Loader2Icon } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from './cn.js'

export interface SpinnerProps extends Omit<ComponentProps<'svg'>, 'aria-label'> {
  /** Accessible name announced for the status. Omit when the spinner is decorative (aria-hidden). */
  label?: string
}

export function Spinner({ className, label, ...props }: SpinnerProps) {
  return (
    <Loader2Icon
      role={label ? 'status' : undefined}
      aria-label={label}
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  )
}
