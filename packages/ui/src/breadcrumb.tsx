'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { ChevronRight, MoreHorizontal } from 'lucide-react'

import { cn } from './cn.js'

function Breadcrumb({
  ref,
  ...props
}: React.ComponentPropsWithoutRef<'nav'> & {
  ref?: React.Ref<HTMLElement>
}) {
  return <nav ref={ref} {...props} />
}
Breadcrumb.displayName = 'Breadcrumb'

function BreadcrumbList({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<'ol'> & { ref?: React.Ref<HTMLOListElement> }) {
  return (
    <ol
      ref={ref}
      className={cn(
        'flex flex-nowrap items-center gap-1.5 min-w-0 text-sm text-muted-foreground sm:gap-2.5',
        className,
      )}
      {...props}
    />
  )
}
BreadcrumbList.displayName = 'BreadcrumbList'

function BreadcrumbItem({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<'li'> & { ref?: React.Ref<HTMLLIElement> }) {
  return (
    <li
      ref={ref}
      className={cn('inline-flex items-center gap-1.5 min-w-0', className)}
      {...props}
    />
  )
}
BreadcrumbItem.displayName = 'BreadcrumbItem'

function BreadcrumbLink({
  asChild,
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<'a'> & {
  asChild?: boolean
  ref?: React.Ref<HTMLAnchorElement>
}) {
  const Comp = asChild ? Slot : 'a'

  return (
    <Comp
      ref={ref}
      className={cn(
        'inline-flex min-h-7 items-center whitespace-nowrap transition-colors hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}
BreadcrumbLink.displayName = 'BreadcrumbLink'

function BreadcrumbPage({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<'span'> & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span
      ref={ref}
      aria-current="page"
      className={cn('block min-w-0 truncate font-normal text-foreground', className)}
      {...props}
    />
  )
}
BreadcrumbPage.displayName = 'BreadcrumbPage'

const BreadcrumbSeparator = ({ children, className, ...props }: React.ComponentProps<'li'>) => (
  <li
    role="presentation"
    aria-hidden="true"
    className={cn('shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5', className)}
    {...props}
  >
    {children ?? <ChevronRight />}
  </li>
)
BreadcrumbSeparator.displayName = 'BreadcrumbSeparator'

const BreadcrumbEllipsis = ({
  className,
  label,
  ...props
}: React.ComponentProps<'span'> & { label: string }) => {
  return (
    <span
      role="presentation"
      className={cn('flex h-9 w-9 items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </span>
  )
}
BreadcrumbEllipsis.displayName = 'BreadcrumbEllipsis'

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
}
