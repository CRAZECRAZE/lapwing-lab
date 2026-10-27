// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/preact'
import type { JSX } from 'preact'
import { afterEach, describe, expect, it } from 'vitest'
import { DockProvider, dockKeyFor, useDock, useDockOpen } from '../../src/state/dock.tsx'
import type { Dock, DockTool } from '../../src/state/dock.tsx'

afterEach(cleanup)

type KeyInit = Partial<Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>> & {
  target?: EventTarget | null
}

const ev = (init: KeyInit): Parameters<typeof dockKeyFor>[0] => ({
  key: '',
  code: '',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  target: document.body,
  ...init,
})

const KEYS: ReadonlyArray<{ tool: DockTool; key: string; upper: string; code: string }> = [
  { tool: 'lookup', key: '/', upper: '?', code: 'Slash' },
  { tool: 'chart', key: 'k', upper: 'K', code: 'KeyK' },
  { tool: 'briefs', key: 'b', upper: 'B', code: 'KeyB' },
  { tool: 'notes', key: 'n', upper: 'N', code: 'KeyN' },
]

describe('dockKeyFor', () => {
  for (const { tool, key, upper, code } of KEYS) {
    describe(tool, () => {
      it('maps the bare key', () => {
        expect(dockKeyFor(ev({ key, code }))).toBe(tool)
      })

      it('maps Alt by code, whatever the key turned into', () => {
        expect(dockKeyFor(ev({ key, code, altKey: true }))).toBe(tool)
        expect(dockKeyFor(ev({ key: '¬', code, altKey: true }))).toBe(tool)
      })

      it('never maps with Ctrl or Meta', () => {
        expect(dockKeyFor(ev({ key, code, ctrlKey: true }))).toBeNull()
        expect(dockKeyFor(ev({ key, code, metaKey: true }))).toBeNull()
        expect(dockKeyFor(ev({ key, code, altKey: true, ctrlKey: true }))).toBeNull()
        expect(dockKeyFor(ev({ key, code, altKey: true, metaKey: true }))).toBeNull()
      })

      it('does not map Alt with Shift', () => {
        expect(dockKeyFor(ev({ key: upper, code, altKey: true, shiftKey: true }))).toBeNull()
      })

      it('maps the bare key inside a text field only with Alt', () => {
        for (const field of [document.createElement('input'), document.createElement('textarea'), document.createElement('select')]) {
          expect(dockKeyFor(ev({ key, code, target: field }))).toBeNull()
          expect(dockKeyFor(ev({ key, code, altKey: true, target: field }))).toBe(tool)
        }
      })
    })
  }

  it('accepts Shift (or Caps Lock) on the letters', () => {
    expect(dockKeyFor(ev({ key: 'K', code: 'KeyK', shiftKey: true }))).toBe('chart')
    expect(dockKeyFor(ev({ key: 'B', code: 'KeyB', shiftKey: true }))).toBe('briefs')
    expect(dockKeyFor(ev({ key: 'N', code: 'KeyN' }))).toBe('notes') // Caps Lock
  })

  it('does not map / with Shift, nor the ? it usually makes', () => {
    expect(dockKeyFor(ev({ key: '/', code: 'Slash', shiftKey: true }))).toBeNull()
    expect(dockKeyFor(ev({ key: '?', code: 'Slash', shiftKey: true }))).toBeNull()
  })

  it('maps nothing else', () => {
    expect(dockKeyFor(ev({ key: 'a', code: 'KeyA' }))).toBeNull()
    expect(dockKeyFor(ev({ key: 'Escape', code: 'Escape' }))).toBeNull()
    expect(dockKeyFor(ev({ key: 'k', code: 'KeyA', altKey: true }))).toBeNull() // Alt goes by the physical key
    expect(dockKeyFor(ev({ key: '', code: '' }))).toBeNull()
  })

  it('treats a null or non-element target as not editable', () => {
    expect(dockKeyFor(ev({ key: 'k', target: null }))).toBe('chart')
    expect(dockKeyFor(ev({ key: 'k', target: window }))).toBe('chart')
    expect(dockKeyFor(ev({ key: 'k', target: document }))).toBe('chart')
    expect(dockKeyFor(ev({ key: 'k', target: document.createTextNode('x') }))).toBe('chart')
  })

  it('treats buttons, checkboxes and the like as not editable, but text-like inputs as editable', () => {
    for (const type of ['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image']) {
      const input = document.createElement('input')
      input.type = type
      expect(dockKeyFor(ev({ key: 'k', target: input })), type).toBe('chart')
    }
    for (const type of ['text', 'search', 'email', 'number', 'password', 'url', 'tel', 'date']) {
      const input = document.createElement('input')
      input.type = type
      expect(dockKeyFor(ev({ key: 'k', target: input })), type).toBeNull()
    }
    expect(dockKeyFor(ev({ key: 'k', target: document.createElement('button') }))).toBe('chart')
  })

  it('treats contenteditable (and its children) as editable, but not contenteditable=false', () => {
    const box = document.createElement('div')
    box.setAttribute('contenteditable', 'true')
    const child = document.createElement('span')
    box.append(child)
    expect(dockKeyFor(ev({ key: 'k', target: box }))).toBeNull()
    expect(dockKeyFor(ev({ key: 'k', target: child }))).toBeNull()
    expect(dockKeyFor(ev({ key: 'k', target: box, altKey: true, code: 'KeyK' }))).toBe('chart')
    const off = document.createElement('div')
    off.setAttribute('contenteditable', 'false')
    expect(dockKeyFor(ev({ key: 'k', target: off }))).toBe('chart')
  })
})

let dock: Dock
function Probe(): JSX.Element {
  dock = useDock()
  return <p data-testid="tool">{dock.tool ?? 'none'}</p>
}

const shown = (): string => screen.getByTestId('tool').textContent!

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(e)
  })
  return e
}

function mount(): ReturnType<typeof render> {
  return render(
    <DockProvider>
      <Probe />
    </DockProvider>,
  )
}

function field<K extends 'input' | 'textarea'>(tag: K): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  document.body.append(el)
  el.focus()
  return el
}

describe('DockProvider keys', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('/ opens Lookup and a second / closes it; both are default-prevented', () => {
    mount()
    expect(shown()).toBe('none')
    const first = press(document.body, { key: '/', code: 'Slash' })
    expect(shown()).toBe('lookup')
    expect(first.defaultPrevented).toBe(true)
    const second = press(document.body, { key: '/', code: 'Slash' })
    expect(shown()).toBe('none')
    expect(second.defaultPrevented).toBe(true)
  })

  it('K, B and N open their tools, and another key switches tools', () => {
    mount()
    press(document.body, { key: 'k', code: 'KeyK' })
    expect(shown()).toBe('chart')
    press(document.body, { key: 'b', code: 'KeyB' })
    expect(shown()).toBe('briefs')
    press(document.body, { key: 'N', code: 'KeyN', shiftKey: true })
    expect(shown()).toBe('notes')
  })

  it('a mapped key does not reach the page below', () => {
    mount()
    let reached = 0
    const listener = (): void => {
      reached++
    }
    document.body.addEventListener('keydown', listener)
    press(document.body, { key: 'k', code: 'KeyK' })
    document.body.removeEventListener('keydown', listener)
    expect(reached).toBe(0)
  })

  it('typing k in an input or a textarea does nothing', () => {
    mount()
    for (const tag of ['input', 'textarea'] as const) {
      const el = field(tag)
      const e = press(el, { key: 'k', code: 'KeyK' })
      expect(shown()).toBe('none')
      expect(e.defaultPrevented).toBe(false)
    }
  })

  it('Alt+K works from inside a textarea', () => {
    mount()
    const e = press(field('textarea'), { key: 'k', code: 'KeyK', altKey: true })
    expect(shown()).toBe('chart')
    expect(e.defaultPrevented).toBe(true)
  })

  it('ignores held-key repeats (no flicker) but still keeps them from the page', () => {
    mount()
    press(document.body, { key: 'k', code: 'KeyK' })
    const again = press(document.body, { key: 'k', code: 'KeyK', repeat: true })
    expect(shown()).toBe('chart')
    expect(again.defaultPrevented).toBe(true)
  })

  it('ignores keys while an input method is composing', () => {
    mount()
    const e = press(document.body, { key: 'k', code: 'KeyK', isComposing: true })
    expect(shown()).toBe('none')
    expect(e.defaultPrevented).toBe(false)
  })

  it('Escape closes an open tool and is stopped; with nothing open it is left alone', () => {
    mount()
    let reached = 0
    const listener = (): void => {
      reached++
    }
    document.body.addEventListener('keydown', listener)
    try {
      const idle = press(document.body, { key: 'Escape', code: 'Escape' })
      expect(idle.defaultPrevented).toBe(false)
      expect(reached).toBe(1)

      press(document.body, { key: 'b', code: 'KeyB' })
      const closing = press(document.body, { key: 'Escape', code: 'Escape' })
      expect(shown()).toBe('none')
      expect(closing.defaultPrevented).toBe(true)
      expect(reached).toBe(1)
    } finally {
      document.body.removeEventListener('keydown', listener)
    }
  })

  it('a held Escape that closed a tool does not go on to reach the page; a fresh Escape does', () => {
    mount()
    let reached = 0
    const listener = (): void => {
      reached++
    }
    document.body.addEventListener('keydown', listener)
    try {
      press(document.body, { key: 'k', code: 'KeyK' })
      press(document.body, { key: 'Escape', code: 'Escape' })
      press(document.body, { key: 'Escape', code: 'Escape', repeat: true })
      press(document.body, { key: 'Escape', code: 'Escape', repeat: true })
      expect(reached).toBe(0)
      press(document.body, { key: 'Escape', code: 'Escape' })
      expect(reached).toBe(1)
    } finally {
      document.body.removeEventListener('keydown', listener)
    }
  })

  it('removes the window listener at unmount', () => {
    const { unmount } = mount()
    unmount()
    const e = press(document.body, { key: '/', code: 'Slash' })
    expect(e.defaultPrevented).toBe(false)
  })

  it('open, close and toggle from code; toggle(other) switches', () => {
    mount()
    act(() => dock.open('notes'))
    expect(shown()).toBe('notes')
    act(() => dock.toggle('chart'))
    expect(shown()).toBe('chart')
    act(() => dock.toggle('chart'))
    expect(shown()).toBe('none')
    act(() => dock.open('lookup'))
    act(() => dock.close())
    expect(shown()).toBe('none')
  })
})

describe('outside a provider', () => {
  it('useDock throws a clear error', () => {
    function Bare(): null {
      useDock()
      return null
    }
    expect(() => render(<Bare />)).toThrow(/DockProvider/)
  })

  it('useDockOpen is false', () => {
    function Bare(): JSX.Element {
      return <p data-testid="open">{String(useDockOpen())}</p>
    }
    render(<Bare />)
    expect(screen.getByTestId('open').textContent).toBe('false')
  })

  it('useDockOpen follows the provider', () => {
    function Open(): JSX.Element {
      dock = useDock()
      return <p data-testid="open">{String(useDockOpen())}</p>
    }
    render(
      <DockProvider>
        <Open />
      </DockProvider>,
    )
    expect(screen.getByTestId('open').textContent).toBe('false')
    act(() => dock.open('briefs'))
    expect(screen.getByTestId('open').textContent).toBe('true')
  })
})
