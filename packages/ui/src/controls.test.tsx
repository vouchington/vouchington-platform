// @vitest-environment jsdom
import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Checkbox,
  RadioGroup,
  RadioGroupItem,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  toggleVariants,
} from './index.js'

afterEach(cleanup)

describe('Checkbox', () => {
  it('derives aria-labelledby from id and toggles', () => {
    const onChange = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    render(<Checkbox id="terms" ref={ref} onCheckedChange={onChange} />)
    const box = screen.getByRole('checkbox')
    expect(box.getAttribute('aria-labelledby')).toBe('terms-label')
    fireEvent.click(box)
    expect(onChange).toHaveBeenCalledWith(true)
    expect(ref.current).toBe(box)
  })

  it('prefers explicit aria props and omits labelledby without an id', () => {
    const { rerender } = render(<Checkbox aria-label="Agree" aria-labelledby="x" />)
    expect(screen.getByRole('checkbox').getAttribute('aria-labelledby')).toBe('x')
    expect(screen.getByRole('checkbox').getAttribute('aria-label')).toBe('Agree')
    rerender(<Checkbox />)
    expect(screen.getByRole('checkbox').getAttribute('aria-labelledby')).toBeNull()
  })
})

describe('Switch and RadioGroup', () => {
  it('Switch toggles state', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Switch ref={ref} aria-label="Flag" />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('data-state')).toBe('unchecked')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('data-state')).toBe('checked')
    expect(ref.current).toBe(toggle)
  })

  it('RadioGroup selects an item', () => {
    const groupRef = createRef<HTMLDivElement>()
    const itemRef = createRef<HTMLButtonElement>()
    render(
      <RadioGroup ref={groupRef} defaultValue="a" className="extra">
        <RadioGroupItem value="a" aria-label="A" />
        <RadioGroupItem value="b" aria-label="B" ref={itemRef} />
      </RadioGroup>,
    )
    expect(screen.getByRole('radio', { name: 'A' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'B' }))
    expect(screen.getByRole('radio', { name: 'B' }).getAttribute('aria-checked')).toBe('true')
    expect(groupRef.current?.className).toContain('extra')
    expect(itemRef.current).toBeTruthy()
  })
})

describe('Toggle and ToggleGroup', () => {
  it('Toggle applies variants and flips pressed state', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Toggle ref={ref} variant="outline" size="sm">
        Bold
      </Toggle>,
    )
    const button = screen.getByRole('button', { name: 'Bold' })
    expect(button.className).toContain('border-input')
    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(ref.current).toBe(button)
    expect(toggleVariants()).toContain('h-9')
  })

  it('ToggleGroup provides context defaults and allows per-item overrides', () => {
    const groupRef = createRef<HTMLDivElement>()
    const itemRef = createRef<HTMLButtonElement>()
    render(
      <ToggleGroup type="single" variant="outline" size="lg" ref={groupRef}>
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b" variant="default" size="sm" ref={itemRef}>
          B
        </ToggleGroupItem>
      </ToggleGroup>,
    )
    expect(screen.getByText('A').className).toContain('border-input')
    expect(screen.getByText('A').className).toContain('h-10')
    expect(screen.getByText('B').className).toContain('h-8')
    expect(screen.getByText('B').className).not.toContain('border-input')
    expect(groupRef.current).toBeTruthy()
    expect(itemRef.current).toBeTruthy()
  })
})

describe('Tabs', () => {
  it('shows the active panel and switches on interaction', () => {
    const refs = [
      createRef<HTMLDivElement>(),
      createRef<HTMLButtonElement>(),
      createRef<HTMLDivElement>(),
    ] as const
    render(
      <Tabs defaultValue="one">
        <TabsList ref={refs[0]!}>
          <TabsTrigger value="one" ref={refs[1]!}>
            One
          </TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one" ref={refs[2]!}>
          First
        </TabsContent>
        <TabsContent value="two">Second</TabsContent>
      </Tabs>,
    )
    expect(screen.getByText('First')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Two' }))
    expect(screen.getByText('Second')).toBeTruthy()
    for (const ref of refs) expect(ref.current).toBeTruthy()
  })
})

describe('Accordion', () => {
  it('expands content', () => {
    const refs = [createRef<HTMLDivElement>(), createRef<HTMLButtonElement>()] as const
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="a" ref={refs[0]!}>
          <AccordionTrigger ref={refs[1]!}>Question</AccordionTrigger>
          <AccordionContent>Answer</AccordionContent>
        </AccordionItem>
      </Accordion>,
    )
    expect(screen.queryByText('Answer')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Question' }))
    expect(screen.getByText('Answer')).toBeTruthy()
    expect(refs[0]!.current).toBeTruthy()
    expect(refs[1]!.current).toBeTruthy()
  })

  it('forwards the content ref', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Accordion type="single" defaultValue="a">
        <AccordionItem value="a">
          <AccordionTrigger>Q</AccordionTrigger>
          <AccordionContent ref={ref} className="extra">
            A
          </AccordionContent>
        </AccordionItem>
      </Accordion>,
    )
    expect(ref.current).toBeTruthy()
  })
})
