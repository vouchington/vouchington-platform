import type { ComponentProps, Ref } from 'react'

import { cn } from './cn.js'

export function Input({
  className,
  ref,
  ...props
}: ComponentProps<'input'> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      className={cn(
        'flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      ref={ref}
      {...props}
    />
  )
}
