import { createContext } from 'preact'
import type { ComponentChildren, JSX } from 'preact'
import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'

/** The quick-pull tools that open as a drawer over the right-hand side of the page. */
export type DockTool = 'lookup' | 'chart' | 'briefs' | 'notes'

export type Dock = {
  /** The open tool, or null when the drawer is closed. */
  tool: DockTool | null
  open(tool: DockTool): void
  close(): void
  /** Opens the tool, or closes it when it is the one already open. */
  toggle(tool: DockTool): void
}

const DockContext = createContext<Dock | null>(null)
/** How many drills are mounted under the provider; while above zero only the Alt forms open a tool. */
const DrillCountContext = createContext<{ current: number } | null>(null)

/** Alt+key goes by the physical key, so layouts that turn Alt+letter into a symbol still work. */
const BY_CODE: Readonly<Record<string, DockTool>> = { Slash: 'lookup', KeyK: 'chart', KeyB: 'briefs', KeyN: 'notes' }
/** Bare keys go by the character typed, case-insensitively. */
const BY_KEY: Readonly<Record<string, DockTool>> = { '/': 'lookup', k: 'chart', b: 'briefs', n: 'notes' }

/** Input types that take no typing: a bare key on them is still a hotkey. */
const NOT_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image'])

/** True when keys typed at `target` would edit text. Null, non-elements and shadow hosts count as not editable. */
function isEditable(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false
  if (target instanceof HTMLInputElement) return !NOT_TEXT_INPUTS.has(target.type)
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLElement && target.isContentEditable) return true
  // isContentEditable is missing in some DOMs (jsdom): fall back to the nearest contenteditable attribute.
  const host = target.closest('[contenteditable]')
  return host !== null && host.getAttribute('contenteditable') !== 'false'
}

/**
 * The tool a keydown asks for, or null. Never with Ctrl or Meta (browser shortcuts). With Alt (and no Shift) by the
 * physical key, from anywhere: that is the form for drill screens, whose sink is a text field. Without Alt by the
 * key typed, only when the focus is not in a text field; Shift (or Caps Lock) is fine on the letters, not on `/`.
 * `altOnly` (a drill is on screen, whose board types stray letters anywhere) maps only the Alt forms.
 */
export function dockKeyFor(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'target'>,
  opts: { altOnly?: boolean } = {},
): DockTool | null {
  if (e.ctrlKey || e.metaKey) return null
  if (e.altKey) return e.shiftKey ? null : (BY_CODE[e.code] ?? null)
  if (opts.altOnly) return null
  const key = typeof e.key === 'string' ? e.key.toLowerCase() : ''
  const tool = Object.hasOwn(BY_KEY, key) ? BY_KEY[key] : null
  if (tool === null || (e.shiftKey && key === '/')) return null
  return isEditable(e.target) ? null : tool
}

export function DockProvider({ children }: { children: ComponentChildren }): JSX.Element {
  const [tool, setTool] = useState<DockTool | null>(null)
  // The window listener and toggle() read the latest tool here: it is set at once, the state a render later.
  const current = useRef<DockTool | null>(null)
  const drills = useRef(0)

  const dock = useMemo<Dock>(() => {
    const set = (next: DockTool | null): void => {
      current.current = next
      setTool(next)
    }
    return {
      tool,
      open: (t) => set(t),
      close: () => set(null),
      toggle: (t) => set(current.current === t ? null : t),
    }
  }, [tool])

  // A layout effect, so the listener is gone synchronously at unmount (Preact defers useEffect cleanups).
  // Capture phase on window: it runs before any element's own handler, the drill's sink included.
  useLayoutEffect(() => {
    /** An Escape that closed a tool: its held repeats must not go on to exit a drill. */
    let escapeClosed = false
    const onKeyDown = (e: KeyboardEvent): void => {
      // A modal dialog (ConfirmDialog) is in charge of the keys and the focus: leave everything to it.
      if (document.querySelector('[aria-modal="true"]')) return
      if (e.isComposing) return
      if (!e.repeat) escapeClosed = false
      if (e.key === 'Escape') {
        if (current.current === null && !(e.repeat && escapeClosed)) return
        e.preventDefault()
        e.stopPropagation()
        if (current.current !== null) {
          escapeClosed = true
          current.current = null
          setTool(null)
        }
        return
      }
      const next = dockKeyFor(e, { altOnly: drills.current > 0 })
      if (next === null) return
      e.preventDefault()
      e.stopPropagation()
      // A held key must not flicker the drawer: only the first press toggles.
      if (e.repeat) return
      current.current = current.current === next ? null : next
      setTool(current.current)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  return (
    <DrillCountContext.Provider value={drills}>
      <DockContext.Provider value={dock}>{children}</DockContext.Provider>
    </DrillCountContext.Provider>
  )
}

/**
 * Marks a drill as on screen while the calling component is mounted: the bare keys stop opening tools (the board's
 * stray output would trigger them once the focus leaves the drill's sink), the Alt forms keep working. No-op outside
 * a provider. A layout effect, so the mark is gone synchronously at unmount.
 */
export function useDockDrillMarker(): void {
  const drills = useContext(DrillCountContext)
  useLayoutEffect(() => {
    if (!drills) return
    drills.current++
    return () => {
      drills.current--
    }
  }, [drills])
}

export function useDock(): Dock {
  const dock = useContext(DockContext)
  if (!dock) throw new Error('useDock() must be used inside a <DockProvider>')
  return dock
}

/** The dock, or null outside a provider (for chrome that should simply leave the tools out). */
export function useDockOptional(): Dock | null {
  return useContext(DockContext)
}

/** True while a tool is open; false outside a provider. */
export function useDockOpen(): boolean {
  return useContext(DockContext)?.tool != null
}
