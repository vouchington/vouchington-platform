// @vitest-environment jsdom
import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorBoundary,
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Toaster,
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
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
})

afterEach(cleanup)

describe('DropdownMenu', () => {
  it('renders items, checkbox items, labels and separators', () => {
    const onSelect = vi.fn()
    const content = createRef<HTMLDivElement>()
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent ref={content}>
          <DropdownMenuLabel inset>Label</DropdownMenuLabel>
          <DropdownMenuLabel>Plain label</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSelect}>Plain</DropdownMenuItem>
          <DropdownMenuItem inset>Inset</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>Checked</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Plain' }))
    expect(onSelect).toHaveBeenCalled()
    expect(screen.getByText('Inset').className).toContain('pl-8')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Checked' })).toBeTruthy()
    expect(content.current).toBeTruthy()
  })
})

describe('Menubar', () => {
  it('opens a menu with items', () => {
    render(
      <Menubar value="file">
        <MenubarMenu value="file">
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>New</MenubarItem>
            <MenubarItem inset>Inset</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    )
    expect(screen.getByText('Inset').className).toContain('pl-8')
  })
})

describe('Select', () => {
  it('renders the trigger value and open options', () => {
    render(
      <Select open value="a">
        <SelectTrigger aria-label="Pick">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            <SelectLabel>Group</SelectLabel>
            <SelectItem value="a">Alpha</SelectItem>
            <SelectSeparator />
            <SelectItem value="b">Beta</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    )
    expect(screen.getByRole('combobox', { name: 'Pick', hidden: true })).toBeTruthy()
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0)
  })

  it('derives aria-labelledby from the id', () => {
    render(
      <Select>
        <SelectTrigger id="field">
          <SelectValue />
        </SelectTrigger>
      </Select>,
    )
    expect(screen.getByRole('combobox').getAttribute('aria-labelledby')).toBe('field-label')
  })

  it('renders popper-less content', () => {
    render(
      <Select open>
        <SelectTrigger aria-label="Pick">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Alpha</SelectItem>
        </SelectContent>
      </Select>,
    )
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0)
  })
})

describe('InputOTP', () => {
  it('renders slots, separator and active caret', () => {
    render(
      <InputOTP maxLength={4} value="12" onChange={() => {}} autoFocus>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          <InputOTPSlot index={2} />
          <InputOTPSlot index={3} />
        </InputOTPGroup>
      </InputOTP>,
    )
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })
})

describe('Breadcrumb', () => {
  it('renders the trail and injected ellipsis label', () => {
    render(
      <Breadcrumb aria-label="Trail">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbEllipsis label="More" />
          </BreadcrumbItem>
          <BreadcrumbSeparator>/</BreadcrumbSeparator>
          <BreadcrumbItem>
            <BreadcrumbPage>Now</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    expect(screen.getByRole('navigation', { name: 'Trail' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy()
    expect(screen.getByText('More')).toBeTruthy()
    expect(screen.getByText('Now').getAttribute('aria-current')).toBe('page')
  })

  it('renders links asChild', () => {
    render(
      <BreadcrumbLink asChild>
        <button type="button">Custom</button>
      </BreadcrumbLink>,
    )
    expect(screen.getByRole('button', { name: 'Custom' })).toBeTruthy()
  })
})

describe('Command', () => {
  it('renders the palette with every part', () => {
    const input = createRef<HTMLInputElement>()
    render(
      <Command>
        <CommandInput ref={input} placeholder="Search..." />
        <CommandList>
          <CommandEmpty>Nothing</CommandEmpty>
          <CommandGroup heading="Group">
            <CommandItem>
              Item <CommandShortcut>K</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
        </CommandList>
      </Command>,
    )
    expect(screen.getByPlaceholderText('Search...')).toBeTruthy()
    expect(input.current).toBe(screen.getByPlaceholderText('Search...'))
  })

  it('supports function refs and unmounting on CommandInput', () => {
    const calls: Array<HTMLInputElement | null> = []
    const { unmount } = render(
      <Command>
        <CommandInput ref={(node) => void calls.push(node)} placeholder="Find" />
      </Command>,
    )
    unmount()
    expect(calls[0]).toBeInstanceOf(HTMLInputElement)
    expect(calls.at(-1)).toBeNull()
  })

  it('works without a ref', () => {
    render(
      <Command>
        <CommandInput placeholder="No ref" />
      </Command>,
    )
    expect(screen.getByPlaceholderText('No ref')).toBeTruthy()
  })

  it('renders the dialog with injected copy', () => {
    render(
      <CommandDialog open title="Search" description="Find things" closeLabel="Close search">
        <CommandInput placeholder="Type" />
      </CommandDialog>,
    )
    expect(screen.getByText('Find things')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close search' })).toBeTruthy()
  })
})

describe('ErrorBoundary', () => {
  it('renders children until one throws, then the fallback', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Boom(): never {
      throw new Error('boom')
    }
    const { rerender } = render(
      <ErrorBoundary fallback={<p>Fallback</p>}>
        <p>Fine</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('Fine')).toBeTruthy()
    rerender(
      <ErrorBoundary fallback={<p>Fallback</p>}>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Fallback')).toBeTruthy()
    spy.mockRestore()
  })
})

describe('Toaster', () => {
  it('renders with an injected theme', () => {
    const { container } = render(<Toaster theme="dark" />)
    expect(container.querySelector('section')).toBeTruthy()
  })
})
