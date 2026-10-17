import * as React from 'react'

import { cn } from './cn.js'

function Table({
  className,
  label,
  ref,
  ...props
}: React.HTMLAttributes<HTMLTableElement> & {
  /** Accessible name for the scrollable region (e.g. the caption text). */
  label?: string
  ref?: React.Ref<HTMLTableElement>
}) {
  return (
    <div
      className="relative w-full overflow-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      tabIndex={0}
      role={label ? 'region' : undefined}
      aria-label={label}
    >
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}
Table.displayName = 'Table'

function TableHeader({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement> & { ref?: React.Ref<HTMLTableSectionElement> }) {
  return <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
}
TableHeader.displayName = 'TableHeader'

function TableBody({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement> & { ref?: React.Ref<HTMLTableSectionElement> }) {
  return <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}
TableBody.displayName = 'TableBody'

function TableFooter({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement> & { ref?: React.Ref<HTMLTableSectionElement> }) {
  return (
    <tfoot
      ref={ref}
      className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  )
}
TableFooter.displayName = 'TableFooter'

function TableRow({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { ref?: React.Ref<HTMLTableRowElement> }) {
  return (
    <tr
      ref={ref}
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  )
}
TableRow.displayName = 'TableRow'

function TableHead({
  className,
  ref,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { ref?: React.Ref<HTMLTableCellElement> }) {
  return (
    <th
      ref={ref}
      className={cn(
        'h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  )
}
TableHead.displayName = 'TableHead'

function TableCell({
  className,
  ref,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { ref?: React.Ref<HTMLTableCellElement> }) {
  return (
    <td
      ref={ref}
      className={cn(
        'p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  )
}
TableCell.displayName = 'TableCell'

function TableCaption({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLTableCaptionElement> & { ref?: React.Ref<HTMLTableCaptionElement> }) {
  return (
    <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
  )
}
TableCaption.displayName = 'TableCaption'

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
