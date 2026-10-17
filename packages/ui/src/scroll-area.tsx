'use client'

import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'

import { cn } from './cn.js'

function ScrollBar({
  className,
  orientation = 'vertical',
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> & {
  ref?: React.Ref<React.ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>>
}) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={ref}
      orientation={orientation}
      className={cn(
        'flex touch-none select-none transition-colors',
        orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent p-[1px]',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-[1px]',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

function ScrollArea({
  className,
  children,
  horizontalScrollbar = false,
  viewportTabIndex = 0,
  ref,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>, 'asChild'> & {
  /** Also render a horizontal scrollbar (scrollbars must be siblings of the viewport). */
  horizontalScrollbar?: boolean
  /** Tab stop of the scrollable viewport; pass -1 to skip it. */
  viewportTabIndex?: number
  ref?: React.Ref<React.ComponentRef<typeof ScrollAreaPrimitive.Root>>
}) {
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        tabIndex={viewportTabIndex}
        className="h-full w-full rounded-[inherit] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      {horizontalScrollbar && <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

export { ScrollArea, ScrollBar }
