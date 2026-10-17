// @vitest-environment jsdom
import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  Badge,
  Button,
  Input,
  Kbd,
  KbdGroup,
  Label,
  Separator,
  Skeleton,
  Spinner,
  Textarea,
  buttonVariants,
  cn,
} from './index.js'

afterEach(cleanup)

describe('cn', () => {
  it('merges conflicting tailwind classes and drops falsy values', () => {
    expect(cn('px-2', false, 'px-4')).toBe('px-4')
  })
})

describe('Button', () => {
  it('renders a button with variant classes', () => {
    render(<Button variant="destructive">Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' }).className).toContain('bg-destructive')
  })

  it('disables and marks busy while loading, with a decorative spinner', () => {
    const { container } = render(<Button loading>Save</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveProperty('disabled', true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps an explicitly disabled button disabled when not loading', () => {
    render(<Button disabled>Off</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveProperty('disabled', true)
    expect(button.getAttribute('aria-busy')).toBeNull()
  })

  it('forwards the ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Ref</Button>)
    expect(ref.current?.tagName).toBe('BUTTON')
  })

  it('renders the child element with asChild and never adds a spinner', () => {
    render(
      <Button asChild loading disabled>
        <a href="/x">Link</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Link' })
    expect(link.className).toContain('bg-primary')
    expect(link.getAttribute('aria-busy')).toBeNull()
    expect(link.querySelector('svg')).toBeNull()
    expect(link.getAttribute('aria-disabled')).toBe('true')
    expect(link.getAttribute('tabindex')).toBe('-1')
    expect(fireEvent.click(link)).toBe(false)
  })

  it('leaves an enabled asChild link interactive', () => {
    render(
      <Button asChild>
        <a href="/z">Go</a>
      </Button>,
    )
    expect(screen.getByRole('link').getAttribute('aria-disabled')).toBeNull()
  })

  it('exposes variants for non-button elements', () => {
    expect(buttonVariants({ size: 'sm' })).toContain('h-7')
  })
})

describe('Spinner', () => {
  it('uses the injected label as its accessible name', () => {
    render(<Spinner label="Chargement" />)
    expect(screen.getByRole('status', { name: 'Chargement' })).toBeTruthy()
  })
})

describe('Badge', () => {
  it('renders variants and supports asChild', () => {
    render(
      <>
        <Badge>One</Badge>
        <Badge variant="outline" asChild>
          <a href="/y">Two</a>
        </Badge>
      </>,
    )
    expect(screen.getByText('One').className).toContain('bg-primary')
    expect(screen.getByRole('link', { name: 'Two' }).className).toContain('text-foreground')
  })
})

describe('form primitives', () => {
  it('Label, Input and Textarea forward props and refs', () => {
    const input = createRef<HTMLInputElement>()
    const area = createRef<HTMLTextAreaElement>()
    const label = createRef<HTMLLabelElement>()
    render(
      <>
        <Label ref={label} htmlFor="a" className="extra">
          Name
        </Label>
        <Input id="a" ref={input} className="custom" />
        <Textarea aria-label="Bio" ref={area} />
      </>,
    )
    expect(screen.getByLabelText('Name')).toBe(input.current)
    expect(label.current?.className).toContain('extra')
    expect(input.current?.className).toContain('custom')
    expect(area.current?.tagName).toBe('TEXTAREA')
  })
})

describe('layout primitives', () => {
  it('Separator picks sizing per orientation', () => {
    const { container, rerender } = render(<Separator />)
    expect(container.firstElementChild?.className).toContain('h-[1px]')
    rerender(<Separator orientation="vertical" decorative={false} />)
    expect(container.firstElementChild?.className).toContain('w-[1px]')
  })

  it('Separator forwards refs', () => {
    const ref = createRef<HTMLDivElement>()
    render(<Separator ref={ref} />)
    expect(ref.current).toBeTruthy()
  })

  it('Skeleton, Kbd and KbdGroup render with merged classes', () => {
    render(
      <>
        <Skeleton data-testid="s" className="h-4" />
        <KbdGroup data-testid="g">
          <Kbd>K</Kbd>
        </KbdGroup>
      </>,
    )
    expect(screen.getByTestId('s').className).toContain('animate-pulse')
    expect(screen.getByTestId('g').className).toContain('inline-flex')
    expect(screen.getByText('K').tagName).toBe('KBD')
  })
})
