'use client'

import type { ComponentPropsWithoutRef, ComponentRef, Ref } from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'

import { cn } from './cn.js'

export type LabelProps = ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & {
  ref?: Ref<ComponentRef<typeof LabelPrimitive.Root>>
}

export function Label({ className, ref, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  )
}
