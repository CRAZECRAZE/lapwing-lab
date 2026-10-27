// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import type { JSX } from 'preact'
import { afterEach, describe, expect, it } from 'vitest'
import { DockProvider, useDock } from '../../src/state/dock.tsx'
import type { Dock } from '../../src/state/dock.tsx'
import { DockHost, TOOLS } from '../../src/ui/DockHost.tsx'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

let dock: Dock
function Probe(): JSX.Element {
  dock = useDock()
  return (
    <button type="button" data-testid="opener">
      opener
    </button>
  )
}

function mount(): ReturnType<typeof render> {
  return render(
    <DockProvider>
      <Probe />
      <DockHost />
    </DockProvider>,
  )
}

const drawer = (): HTMLElement | null => document.querySelector('.dock-drawer')

describe('DockHost', () => {
  it('renders nothing while closed', () => {
    mount()
    expect(drawer()).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders a labelled, non-modal drawer per tool, with the title, a Close button and the placeholder', () => {
    mount()
    for (const [tool, label] of [
      ['lookup', 'Lookup'],
      ['chart', 'Key chart'],
      ['briefs', 'Briefs so far'],
      ['notes', 'My notes'],
    ] as const) {
      act(() => dock.open(tool))
      const box = screen.getByRole('dialog', { name: label })
      expect(box.classList.contains('dock-drawer')).toBe(true)
      expect(box.hasAttribute('data-dock')).toBe(true)
      expect(box.hasAttribute('aria-modal')).toBe(false)
      expect(screen.getByRole('heading', { level: 2, name: label })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
      expect(box.textContent).toContain('Coming in this milestone.')
    }
  })

  it('Close closes it', () => {
    mount()
    act(() => dock.open('lookup'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(drawer()).toBeNull()
    expect(dock.tool).toBeNull()
  })

  it('moves the focus into the drawer on open and back to the opener on close', () => {
    mount()
    const opener = screen.getByTestId('opener')
    opener.focus()
    act(() => dock.open('chart'))
    expect(document.activeElement).toBe(drawer())
    act(() => dock.close())
    expect(document.activeElement).toBe(opener)
  })

  it('focuses the first [data-autofocus] element of the body when there is one', () => {
    const tools = {
      ...TOOLS,
      lookup: {
        title: 'Lookup',
        Body: (): JSX.Element => (
          <div>
            <button type="button">first</button>
            <input aria-label="query" data-autofocus />
            <input aria-label="second" data-autofocus />
          </div>
        ),
      },
    }
    render(
      <DockProvider>
        <Probe />
        <DockHost tools={tools} />
      </DockProvider>,
    )
    act(() => dock.open('lookup'))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'query' }))
    act(() => dock.open('chart'))
    expect(document.activeElement).toBe(drawer())
  })

  it('returns the focus to the opener after Close too', () => {
    mount()
    const opener = screen.getByTestId('opener')
    opener.focus()
    act(() => dock.open('chart'))
    const close = screen.getByRole('button', { name: 'Close' })
    close.focus()
    fireEvent.click(close)
    expect(document.activeElement).toBe(opener)
  })

  it('skips the return silently when the opener is gone', () => {
    mount()
    const temp = document.createElement('button')
    document.body.append(temp)
    temp.focus()
    act(() => dock.open('notes'))
    temp.remove()
    expect(() => act(() => dock.close())).not.toThrow()
    expect(document.activeElement).not.toBe(temp)
  })

  it('does not trap Tab', () => {
    mount()
    act(() => dock.open('lookup'))
    expect(fireEvent.keyDown(drawer()!, { key: 'Tab' })).toBe(true)
    expect(fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'Tab', shiftKey: true })).toBe(true)
  })

  it('re-runs the focus step when the tool changes while open, and still returns to the first opener', () => {
    mount()
    const opener = screen.getByTestId('opener')
    opener.focus()
    act(() => dock.open('lookup'))
    screen.getByRole('button', { name: 'Close' }).focus()
    act(() => dock.open('briefs'))
    expect(screen.getByRole('dialog', { name: 'Briefs so far' })).toBe(document.activeElement)
    act(() => dock.close())
    expect(document.activeElement).toBe(opener)
  })

  it('Escape from inside the drawer closes it', () => {
    mount()
    const opener = screen.getByTestId('opener')
    opener.focus()
    act(() => dock.open('lookup'))
    act(() => {
      drawer()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(drawer()).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})
