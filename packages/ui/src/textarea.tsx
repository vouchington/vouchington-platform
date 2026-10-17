'use client'

import type { ComponentProps, Ref } from 'react'

import { cn } from './cn.js'

export function Textarea({
  className,
  ref,
  ...props
}: ComponentProps<'textarea'> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      className={cn(
        'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      ref={ref}
      {...props}
    />
  )
}
