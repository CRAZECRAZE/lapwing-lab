// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/preact'
import type { JSX } from 'preact'
import { afterEach, describe, expect, it } from 'vitest'
import { TourProvider, useTourOptional } from '../../src/state/tour.tsx'
import type { TourState } from '../../src/state/tour.tsx'

afterEach(cleanup)

let tour: TourState | null = null

function Probe(): JSX.Element {
  tour = useTourOptional()
  return <p data-testid="open">{tour?.open ? 'open' : 'closed'}</p>
}

const shown = (): string => screen.getByTestId('open').textContent!

function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(e)
  })
  return e
}

const CTRL_SHIFT_T = { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true }

function mount(disabled = false): ReturnType<typeof render> {
  return render(
    <TourProvider disabled={disabled}>
      <Probe />
    </TourProvider>,
  )
}

describe('TourProvider keys', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('Ctrl+Shift+T opens the tour and is default-prevented', () => {
    mount()
    expect(shown()).toBe('closed')
    const e = press(CTRL_SHIFT_T)
    expect(shown()).toBe('open')
    expect(e.defaultPrevented).toBe(true)
  })

  it('goes by the physical key, whatever character the layout types', () => {
    mount()
    press({ key: 'ы', code: 'KeyT', ctrlKey: true, shiftKey: true })
    expect(shown()).toBe('open')
  })

  it('works from inside a text field', () => {
    mount()
    const box = document.createElement('textarea')
    document.body.append(box)
    box.focus()
    press(CTRL_SHIFT_T, box)
    expect(shown()).toBe('open')
  })

  it('ignores plain T, Ctrl+T, Shift+T, and Ctrl+Shift+T with Alt or Meta', () => {
    mount()
    for (const init of [
      { key: 't', code: 'KeyT' },
      { key: 't', code: 'KeyT', ctrlKey: true },
      { key: 'T', code: 'KeyT', shiftKey: true },
      { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true, altKey: true },
      { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true, metaKey: true },
      { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true },
    ]) {
      const e = press(init)
      expect(shown()).toBe('closed')
      expect(e.defaultPrevented).toBe(false)
    }
  })

  it('ignores held-key repeats and input-method composition', () => {
    mount()
    press({ ...CTRL_SHIFT_T, repeat: true })
    press({ ...CTRL_SHIFT_T, isComposing: true })
    expect(shown()).toBe('closed')
  })

  it('does nothing while disabled, and leaves the key to the browser', () => {
    mount(true)
    const e = press(CTRL_SHIFT_T)
    expect(shown()).toBe('closed')
    expect(e.defaultPrevented).toBe(false)
  })

  it('does nothing while a modal dialog is open', () => {
    mount()
    const box = document.createElement('div')
    box.setAttribute('aria-modal', 'true')
    document.body.append(box)
    press(CTRL_SHIFT_T)
    expect(shown()).toBe('closed')
  })

  it('pressing it while open changes nothing', () => {
    mount()
    press(CTRL_SHIFT_T)
    const again = press(CTRL_SHIFT_T)
    expect(shown()).toBe('open')
    expect(again.defaultPrevented).toBe(false)
  })

  it('start() opens, start() while open or disabled is a no-op, close() closes', () => {
    const view = mount()
    act(() => tour!.start())
    expect(shown()).toBe('open')
    act(() => tour!.start())
    expect(shown()).toBe('open')
    act(() => tour!.close())
    expect(shown()).toBe('closed')
    view.rerender(
      <TourProvider disabled>
        <Probe />
      </TourProvider>,
    )
    expect(tour!.disabled).toBe(true)
    act(() => tour!.start())
    expect(shown()).toBe('closed')
  })

  it('closes an open tour when it becomes disabled (a run starts)', () => {
    const view = mount()
    press(CTRL_SHIFT_T)
    expect(shown()).toBe('open')
    view.rerender(
      <TourProvider disabled>
        <Probe />
      </TourProvider>,
    )
    expect(shown()).toBe('closed')
  })

  it('stops listening once the provider is gone', () => {
    const view = mount()
    view.unmount()
    const e = press(CTRL_SHIFT_T)
    expect(e.defaultPrevented).toBe(false)
  })
})

describe('useTourOptional', () => {
  it('is null outside a provider', () => {
    render(<Probe />)
    expect(tour).toBeNull()
    expect(shown()).toBe('closed')
  })
})
