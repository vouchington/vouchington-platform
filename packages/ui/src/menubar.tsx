'use client'

import * as React from 'react'
import * as MenubarPrimitive from '@radix-ui/react-menubar'

import { cn } from './cn.js'

function MenubarMenu({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu {...props} />
}

function Menubar({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Root> & {
  ref?: React.Ref<React.ComponentRef<typeof MenubarPrimitive.Root>>
}) {
  return (
    <MenubarPrimitive.Root
      ref={ref}
      className={cn(
        'flex h-9 items-center gap-1 rounded-md border bg-background p-1 shadow-sm',
        className,
      )}
      {...props}
    />
  )
}
Menubar.displayName = MenubarPrimitive.Root.displayName

function MenubarTrigger({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger> & {
  ref?: React.Ref<React.ComponentRef<typeof MenubarPrimitive.Trigger>>
}) {
  return (
    <MenubarPrimitive.Trigger
      ref={ref}
      className={cn(
        'flex cursor-default select-none items-center rounded-sm px-3 py-1 text-sm font-medium outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
        className,
      )}
      {...props}
    />
  )
}
MenubarTrigger.displayName = MenubarPrimitive.Trigger.displayName

function MenubarContent({
  className,
  align = 'start',
  alignOffset = -4,
  sideOffset = 8,
  forceMount,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Content> & {
  ref?: React.Ref<React.ComponentRef<typeof MenubarPrimitive.Content>>
}) {
  return (
    <MenubarPrimitive.Portal forceMount={forceMount}>
      <MenubarPrimitive.Content
        ref={ref}
        forceMount={forceMount}
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-h-(--radix-menubar-content-available-height) min-w-[12rem] origin-(--radix-menubar-content-transform-origin) overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </MenubarPrimitive.Portal>
  )
}
MenubarContent.displayName = MenubarPrimitive.Content.displayName

function MenubarItem({
  className,
  inset,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Item> & {
  inset?: boolean
  ref?: React.Ref<React.ComponentRef<typeof MenubarPrimitive.Item>>
}) {
  return (
    <MenubarPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  )
}
MenubarItem.displayName = MenubarPrimitive.Item.displayName

export { Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem }
