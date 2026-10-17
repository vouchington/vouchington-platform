import type { ComponentPropsWithoutRef, ComponentRef, Ref } from 'react'
import * as SeparatorPrimitive from '@radix-ui/react-separator'

import { cn } from './cn.js'

export type SeparatorProps = ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> & {
  ref?: Ref<ComponentRef<typeof SeparatorPrimitive.Root>>
}

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ref,
  ...props
}: SeparatorProps) {
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
        className,
      )}
      {...props}
    />
  )
}
