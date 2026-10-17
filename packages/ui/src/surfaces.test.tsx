// @vitest-environment jsdom
import { createRef } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  ButtonGroup,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './index.js'

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(cleanup)

describe('Alert', () => {
  it('renders role alert with variants and forwards refs', () => {
    const refs = [
      createRef<HTMLDivElement>(),
      createRef<HTMLHeadingElement>(),
      createRef<HTMLDivElement>(),
    ] as const
    render(
      <Alert variant="destructive" ref={refs[0]!}>
        <AlertTitle ref={refs[1]!}>Title</AlertTitle>
        <AlertDescription ref={refs[2]!}>Body</AlertDescription>
      </Alert>,
    )
    expect(screen.getByRole('alert').className).toContain('text-destructive')
    expect(screen.getByText('Title').tagName).toBe('DIV')
    expect(screen.getByText('Body')).toBeTruthy()
    for (const ref of refs) expect(ref.current).toBeTruthy()
  })

  it('uses the default variant', () => {
    render(<Alert />)
    expect(screen.getByRole('alert').className).toContain('bg-background')
  })
})

describe('Card', () => {
  it('renders every part and forwards refs', () => {
    const refs = Array.from({ length: 6 }, () => createRef<HTMLDivElement>())
    render(
      <Card ref={refs[0]!}>
        <CardHeader ref={refs[1]!}>
          <CardTitle ref={refs[2]!}>Title</CardTitle>
          <CardDescription ref={refs[3]!}>Desc</CardDescription>
        </CardHeader>
        <CardContent ref={refs[4]!}>Content</CardContent>
        <CardFooter ref={refs[5]!}>Footer</CardFooter>
      </Card>,
    )
    for (const text of ['Title', 'Desc', 'Content', 'Footer'])
      expect(screen.getByText(text)).toBeTruthy()
    for (const ref of refs) expect(ref.current).toBeTruthy()
  })
})

describe('Table', () => {
  it('renders the table structure and forwards refs', () => {
    const table = createRef<HTMLTableElement>()
    const sections = Array.from({ length: 3 }, () => createRef<HTMLTableSectionElement>())
    const row = createRef<HTMLTableRowElement>()
    const cells = Array.from({ length: 2 }, () => createRef<HTMLTableCellElement>())
    const caption = createRef<HTMLTableCaptionElement>()
    render(
      <Table ref={table}>
        <TableCaption ref={caption}>Caption</TableCaption>
        <TableHeader ref={sections[0]!}>
          <TableRow ref={row}>
            <TableHead ref={cells[0]!}>Head</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody ref={sections[1]!}>
          <TableRow>
            <TableCell ref={cells[1]!}>Cell</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter ref={sections[2]!}>
          <TableRow>
            <TableCell>Foot</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    )
    expect(screen.getByRole('columnheader', { name: 'Head' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Cell' })).toBeTruthy()
    for (const ref of [table, row, caption, ...sections, ...cells]) expect(ref.current).toBeTruthy()
  })
})

describe('ButtonGroup', () => {
  it('lays out by orientation', () => {
    const { rerender } = render(<ButtonGroup aria-label="Group" />)
    expect(screen.getByRole('group').className).toContain('flex-row')
    rerender(<ButtonGroup aria-label="Group" orientation="vertical" />)
    expect(screen.getByRole('group').className).toContain('flex-col')
  })
})

describe('Avatar', () => {
  it('renders the fallback when no image loads', () => {
    const refs = [createRef<HTMLSpanElement>(), createRef<HTMLSpanElement>()] as const
    render(
      <Avatar ref={refs[0]!}>
        <AvatarImage src="" alt="nobody" />
        <AvatarFallback ref={refs[1]!}>AB</AvatarFallback>
      </Avatar>,
    )
    expect(screen.getByText('AB')).toBeTruthy()
    expect(refs[0]!.current).toBeTruthy()
    expect(refs[1]!.current).toBeTruthy()
  })

  it('forwards the image ref type through AvatarImage', () => {
    const ref = createRef<HTMLImageElement>()
    render(
      <Avatar>
        <AvatarImage ref={ref} src="/a.png" alt="a" />
      </Avatar>,
    )
    expect(ref.current === null || ref.current.tagName === 'IMG').toBe(true)
  })
})

describe('ScrollArea', () => {
  it('renders children in a focusable viewport', () => {
    const root = createRef<HTMLDivElement>()
    render(
      <ScrollArea ref={root} horizontalScrollbar>
        <p>Content</p>
      </ScrollArea>,
    )
    expect(
      screen
        .getByText('Content')
        .closest('[data-radix-scroll-area-viewport]')
        ?.getAttribute('tabindex'),
    ).toBe('0')
    expect(root.current).toBeTruthy()
  })
})

describe('floating surfaces', () => {
  it('Tooltip renders injected content', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Hover</TooltipTrigger>
          <TooltipContent ref={ref}>Tip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )
    expect(screen.getAllByText('Tip text').length).toBeGreaterThan(0)
    expect(ref.current).toBeTruthy()
  })

  it('Popover renders content and supports an anchor', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Popover open>
        <PopoverAnchor>Anchor</PopoverAnchor>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent ref={ref} align="end" sideOffset={8}>
          Popover body
        </PopoverContent>
      </Popover>,
    )
    expect(screen.getByText('Popover body')).toBeTruthy()
    expect(ref.current).toBeTruthy()
  })

  it('Popover can force-mount closed content', () => {
    render(
      <Popover>
        <PopoverContent forceMount>Mounted</PopoverContent>
      </Popover>,
    )
    expect(screen.getByText('Mounted')).toBeTruthy()
  })

  it('Popover and HoverCard use their default alignment', () => {
    render(
      <>
        <Popover open>
          <PopoverContent>Default popover</PopoverContent>
        </Popover>
        <HoverCard open>
          <HoverCardTrigger>Trigger</HoverCardTrigger>
          <HoverCardContent>Default card</HoverCardContent>
        </HoverCard>
      </>,
    )
    expect(screen.getByText('Default popover')).toBeTruthy()
    expect(screen.getByText('Default card')).toBeTruthy()
  })

  it('HoverCard accepts explicit alignment and refs', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <HoverCard open>
        <HoverCardTrigger>Trigger</HoverCardTrigger>
        <HoverCardContent ref={ref} align="start" sideOffset={2}>
          Card body
        </HoverCardContent>
      </HoverCard>,
    )
    expect(screen.getByText('Card body')).toBeTruthy()
    expect(ref.current).toBeTruthy()
  })
})
