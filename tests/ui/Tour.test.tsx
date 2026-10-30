// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import type { JSX } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DockProvider, useDock } from '../../src/state/dock.tsx'
import type { Dock } from '../../src/state/dock.tsx'
import { TourProvider } from '../../src/state/tour.tsx'
import { Tour, TourHost } from '../../src/ui/Tour.tsx'
import { TOUR_STEPS } from '../../src/ui/tourSteps.ts'

afterEach(cleanup)

const onClose = vi.fn<() => void>()
beforeEach(() => onClose.mockReset())

const COUNT = TOUR_STEPS.length
const dialog = (): HTMLElement => screen.getByRole('dialog')
const next = (): HTMLButtonElement => screen.getByRole('button', { name: /^(Next|Done)$/ }) as HTMLButtonElement
const back = (): HTMLButtonElement | null => screen.queryByRole('button', { name: 'Back' }) as HTMLButtonElement | null
const skip = (): HTMLButtonElement | null => screen.queryByRole('button', { name: 'Skip' }) as HTMLButtonElement | null
const counter = (): string => dialog().querySelector('.tour__count')!.textContent!
const title = (): string => dialog().querySelector('.tour__title')!.textContent!
const ring = (): HTMLElement | null => document.querySelector('.tour__ring')

function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(e)
  })
  return e
}

function goTo(index: number): void {
  for (let i = 0; i < index; i++) fireEvent.click(next())
}

describe('Tour card', () => {
  it('is a modal dialog named by the step title and described by its text', () => {
    render(<Tour onClose={onClose} />)
    const box = dialog()
    expect(box.getAttribute('aria-modal')).toBe('true')
    const label = document.getElementById(box.getAttribute('aria-labelledby')!)
    const description = document.getElementById(box.getAttribute('aria-describedby')!)
    expect(label?.textContent).toBe(TOUR_STEPS[0].title)
    expect(description?.textContent).toBe(TOUR_STEPS[0].body)
    expect(counter()).toBe(`Step 1 of ${COUNT}`)
  })

  it('goes forward with Next and back with Back, hiding Back on step 1', () => {
    render(<Tour onClose={onClose} />)
    expect(back()).toBeNull()
    fireEvent.click(next())
    expect(counter()).toBe(`Step 2 of ${COUNT}`)
    expect(title()).toBe(TOUR_STEPS[1].title)
    expect(back()).not.toBeNull()
    fireEvent.click(next())
    expect(counter()).toBe(`Step 3 of ${COUNT}`)
    fireEvent.click(back()!)
    expect(counter()).toBe(`Step 2 of ${COUNT}`)
    fireEvent.click(back()!)
    expect(counter()).toBe(`Step 1 of ${COUNT}`)
    expect(back()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows Done and no Skip on the last step, and Done closes', () => {
    render(<Tour onClose={onClose} />)
    expect(skip()).not.toBeNull()
    expect(next().textContent).toBe('Next')
    goTo(COUNT - 1)
    expect(counter()).toBe(`Step ${COUNT} of ${COUNT}`)
    expect(skip()).toBeNull()
    expect(next().textContent).toBe('Done')
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(next())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Skip closes from any step', () => {
    render(<Tour onClose={onClose} />)
    goTo(3)
    fireEvent.click(skip()!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc closes, and does not reach the page', () => {
    const outer = vi.fn()
    document.body.addEventListener('keydown', outer)
    try {
      render(<Tour onClose={onClose} />)
      const e = press({ key: 'Escape', code: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(e.defaultPrevented).toBe(true)
      expect(outer).not.toHaveBeenCalled()
    } finally {
      document.body.removeEventListener('keydown', outer)
    }
  })

  it('ArrowRight and ArrowLeft move between steps, and stop at both ends', () => {
    render(<Tour onClose={onClose} />)
    press({ key: 'ArrowLeft', code: 'ArrowLeft' })
    expect(counter()).toBe(`Step 1 of ${COUNT}`)
    press({ key: 'ArrowRight', code: 'ArrowRight' })
    press({ key: 'ArrowRight', code: 'ArrowRight' })
    expect(counter()).toBe(`Step 3 of ${COUNT}`)
    press({ key: 'ArrowLeft', code: 'ArrowLeft' })
    expect(counter()).toBe(`Step 2 of ${COUNT}`)
    for (let i = 0; i < COUNT + 2; i++) press({ key: 'ArrowRight', code: 'ArrowRight' })
    expect(counter()).toBe(`Step ${COUNT} of ${COUNT}`)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves arrows with Alt or Ctrl (browser history) and held repeats alone', () => {
    render(<Tour onClose={onClose} />)
    const alt = press({ key: 'ArrowRight', code: 'ArrowRight', altKey: true })
    press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true })
    press({ key: 'ArrowRight', code: 'ArrowRight', repeat: true })
    expect(counter()).toBe(`Step 1 of ${COUNT}`)
    expect(alt.defaultPrevented).toBe(false)
  })

  it('does not let a held Enter run through the steps', () => {
    render(<Tour onClose={onClose} />)
    const held = press({ key: 'Enter', code: 'Enter', repeat: true }, next())
    expect(held.defaultPrevented).toBe(true)
    const first = press({ key: 'Enter', code: 'Enter' }, next())
    expect(first.defaultPrevented).toBe(false)
  })

  it('stops listening once it is gone', () => {
    const view = render(<Tour onClose={onClose} />)
    view.unmount()
    const e = press({ key: 'Escape', code: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
  })
})

describe('Tour focus', () => {
  it('starts on Next, and stays on the same button when it turns into Done', () => {
    render(<Tour onClose={onClose} />)
    expect(document.activeElement).toBe(next())
    goTo(COUNT - 1)
    expect(next().textContent).toBe('Done')
    expect(document.activeElement).toBe(next())
  })

  it('goes back to Next when the focused button disappears', () => {
    render(<Tour onClose={onClose} />)
    fireEvent.click(next())
    back()!.focus()
    fireEvent.click(back()!)
    expect(back()).toBeNull()
    expect(document.activeElement).toBe(next())
    goTo(COUNT - 2) // from step 1 to the one before the last, where Skip is still there
    skip()!.focus()
    fireEvent.click(next())
    expect(skip()).toBeNull()
    expect(document.activeElement).toBe(next())
  })

  it('keeps Tab inside the card, forwards and backwards', () => {
    render(<Tour onClose={onClose} />)
    goTo(1) // Skip, Back and Next are all there
    const cycle = [skip()!, back()!, next()]
    cycle[0].focus()
    const seen: Element[] = []
    for (let i = 0; i < 4; i++) {
      const e = press({ key: 'Tab', code: 'Tab' }, document.activeElement!)
      expect(e.defaultPrevented).toBe(true)
      seen.push(document.activeElement!)
    }
    expect(seen).toEqual([cycle[1], cycle[2], cycle[0], cycle[1]])
    const back3: Element[] = []
    for (let i = 0; i < 4; i++) {
      press({ key: 'Tab', code: 'Tab', shiftKey: true }, document.activeElement!)
      back3.push(document.activeElement!)
    }
    expect(back3).toEqual([cycle[0], cycle[2], cycle[1], cycle[0]])
  })

  it('pulls a stray focus back into the card on Tab', () => {
    render(<Tour onClose={onClose} />)
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    press({ key: 'Tab', code: 'Tab' }, outside)
    expect(dialog().contains(document.activeElement)).toBe(true)
    outside.focus()
    press({ key: 'Tab', code: 'Tab', shiftKey: true }, outside)
    expect(document.activeElement).toBe(next())
    outside.remove()
  })

  it('gives the focus back to the opener when it closes', () => {
    function Opener(): JSX.Element {
      return (
        <TourProvider disabled={false}>
          <OpenerButton />
          <TourHost />
        </TourProvider>
      )
    }
    function OpenerButton(): JSX.Element {
      return <button type="button">opener</button>
    }
    render(<Opener />)
    const opener = screen.getByRole('button', { name: 'opener' })
    opener.focus()
    press({ key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true }, opener)
    expect(document.activeElement).toBe(next())
    fireEvent.click(skip()!)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('Tour ring', () => {
  afterEach(() => document.body.replaceChildren())

  const addTarget = (selector: 'tabs' | 'tools'): HTMLElement => {
    const el = document.createElement('div')
    if (selector === 'tools') {
      el.className = 'topbar__tools'
    } else {
      el.innerHTML = '<ul class="topbar__tabs"><li><a href="/">Book</a></li></ul>'
    }
    document.body.append(el)
    return el
  }

  it('renders without a ring and without error when the target is missing', () => {
    render(<Tour onClose={onClose} />)
    expect(ring()).toBeNull()
    fireEvent.click(next()) // the Book step names a target that is not on this page
    expect(TOUR_STEPS[1].target).toBeDefined()
    expect(title()).toBe(TOUR_STEPS[1].title)
    expect(ring()).toBeNull()
    expect(dialog().closest('.tour')!.classList.contains('tour--aimed')).toBe(false)
  })

  it('draws a ring around a present target and follows it when it moves', () => {
    addTarget('tabs')
    const link = document.querySelector('.topbar__tabs a[href="/"]') as HTMLElement
    let rect = { top: 10, left: 20, width: 60, height: 30 }
    link.getBoundingClientRect = () => ({ ...rect, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) })
    render(<Tour onClose={onClose} />)
    expect(ring()).toBeNull() // step 1 names nothing
    fireEvent.click(next())
    const box = ring()!
    expect(box).not.toBeNull()
    expect(box.getAttribute('aria-hidden')).toBe('true')
    expect(box.style.top).toBe('7px')
    expect(box.style.left).toBe('17px')
    expect(box.style.width).toBe('66px')
    expect(box.style.height).toBe('36px')
    expect(dialog().closest('.tour')!.classList.contains('tour--aimed')).toBe(true)
    rect = { top: 50, left: 20, width: 60, height: 30 }
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(ring()!.style.top).toBe('47px')
    rect = { top: 80, left: 20, width: 60, height: 30 }
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(ring()!.style.top).toBe('77px')
  })

  it('drops the ring on a step with no target', () => {
    addTarget('tabs')
    render(<Tour onClose={onClose} />)
    fireEvent.click(next())
    expect(ring()).not.toBeNull()
    goTo(TOUR_STEPS.findIndex((s) => s.id === 'ghosts') - 1)
    expect(title()).toBe('Ghosts')
    expect(ring()).toBeNull()
  })
})

describe('Tour with the dock', () => {
  let dock: Dock | undefined
  function Probe(): JSX.Element {
    dock = useDock()
    return <p data-testid="tool">{dock.tool ?? 'none'}</p>
  }

  function mount(): void {
    render(
      <DockProvider>
        <TourProvider disabled={false}>
          <Probe />
          <TourHost />
        </TourProvider>
      </DockProvider>,
    )
  }

  const tool = (): string => screen.getByTestId('tool').textContent!

  it('keeps dock keys and Esc away from the dock while it is open', () => {
    mount()
    press({ key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('dialog')).toBeTruthy()
    press({ key: 'k', code: 'KeyK' }, next())
    press({ key: 'k', code: 'KeyK', altKey: true }, next())
    press({ key: '/', code: 'Slash' }, next())
    expect(tool()).toBe('none')
    // an open tool stays open under Esc, which belongs to the tour
    act(() => dock!.open('notes'))
    press({ key: 'Escape', code: 'Escape' }, next())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(tool()).toBe('notes')
    // and once the tour is gone the dock answers again
    press({ key: 'Escape', code: 'Escape' })
    expect(tool()).toBe('none')
    press({ key: 'k', code: 'KeyK' })
    expect(tool()).toBe('chart')
  })
})
