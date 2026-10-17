// @vitest-environment jsdom
import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
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

describe('Dialog', () => {
  it('renders injected close copy and closes', () => {
    const onOpenChange = vi.fn()
    const ref = createRef<HTMLDivElement>()
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent closeLabel="Fermer" ref={ref}>
          <DialogHeader>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Description</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose>Done</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByText('Description')).toBeTruthy()
    expect(ref.current).toBeTruthy()
  })

  it('can hide the close button and the overlay', () => {
    render(
      <Dialog open>
        <DialogContent hideCloseButton hideOverlay>
          <DialogTitle>Bare</DialogTitle>
          <DialogDescription>Bare description</DialogDescription>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(document.querySelector('.bg-transparent')).toBeTruthy()
  })

  it('renders the overlay by default and forwards title/description refs', () => {
    const refs = [createRef<HTMLHeadingElement>(), createRef<HTMLParagraphElement>()] as const
    render(
      <Dialog open>
        <DialogContent closeLabel="Close">
          <DialogTitle ref={refs[0]}>T</DialogTitle>
          <DialogDescription ref={refs[1]}>D</DialogDescription>
        </DialogContent>
      </Dialog>,
    )
    expect(document.querySelector('.bg-black\\/80')).toBeTruthy()
    expect(refs[0].current).toBeTruthy()
    expect(refs[1].current).toBeTruthy()
  })
})

describe('Sheet', () => {
  it('renders injected close copy for the chosen side', () => {
    render(
      <Sheet open>
        <SheetContent closeLabel="Close panel" side="left">
          <SheetHeader>
            <SheetTitle>Panel</SheetTitle>
            <SheetDescription>About</SheetDescription>
          </SheetHeader>
          <SheetFooter>Foot</SheetFooter>
        </SheetContent>
      </Sheet>,
    )
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeTruthy()
    expect(screen.getByRole('dialog').className).toContain('left-0')
  })

  it('defaults to the right side, can hide the overlay and forwards refs', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Sheet open>
        <SheetContent closeLabel="Close" hideOverlay ref={ref}>
          <SheetTitle>Panel</SheetTitle>
          <SheetDescription>About</SheetDescription>
        </SheetContent>
      </Sheet>,
    )
    expect(screen.getByRole('dialog').className).toContain('right-0')
    expect(document.querySelector('.bg-transparent')).toBeTruthy()
    expect(ref.current).toBeTruthy()
  })
})

describe('force mounting', () => {
  it('mounts closed dialog, sheet and alert dialog content when asked', () => {
    render(
      <>
        <Dialog>
          <DialogContent forceMount hideCloseButton>
            <DialogTitle>Forced dialog</DialogTitle>
            <DialogDescription>d</DialogDescription>
          </DialogContent>
        </Dialog>
        <Sheet>
          <SheetContent forceMount closeLabel="Close">
            <SheetTitle>Forced sheet</SheetTitle>
            <SheetDescription>d</SheetDescription>
          </SheetContent>
        </Sheet>
        <AlertDialog>
          <AlertDialogContent forceMount>
            <AlertDialogTitle>Forced alert</AlertDialogTitle>
            <AlertDialogDescription>d</AlertDialogDescription>
          </AlertDialogContent>
        </AlertDialog>
      </>,
    )
    for (const text of ['Forced dialog', 'Forced sheet', 'Forced alert'])
      expect(screen.getByText(text)).toBeTruthy()
  })
})

describe('AlertDialog', () => {
  it('renders actions and forwards refs', () => {
    const onAction = vi.fn()
    const refs = [createRef<HTMLDivElement>(), createRef<HTMLButtonElement>()] as const
    render(
      <AlertDialog open>
        <AlertDialogContent ref={refs[0]}>
          <AlertDialogHeader>
            <AlertDialogTitle>Sure?</AlertDialogTitle>
            <AlertDialogDescription>Cannot undo</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onAction} ref={refs[1]}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onAction).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('border')
    expect(refs[0].current).toBeTruthy()
    expect(refs[1].current).toBeTruthy()
  })
})
