/* oxlint-disable jsx-a11y/prefer-tag-over-role -- button groups use role=group; no semantic HTML element maps to a non-form button group */
import type { HTMLAttributes, Ref } from 'react'
import { type VariantProps, cva } from 'class-variance-authority'
import { cn } from './cn.js'

const buttonGroupVariants = cva('flex gap-2', {
  variants: {
    orientation: {
      horizontal: 'flex-row flex-wrap items-center',
      vertical: 'flex-col items-stretch',
    },
  },
  defaultVariants: { orientation: 'horizontal' },
})

export interface ButtonGroupProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof buttonGroupVariants> {
  ref?: Ref<HTMLDivElement>
}

export function ButtonGroup({ className, orientation, ref, ...props }: ButtonGroupProps) {
  return (
    <div
      ref={ref}
      role="group"
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  )
}
