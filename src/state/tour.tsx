import { createContext } from 'preact'
import type { ComponentChildren, JSX } from 'preact'
import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'

export type TourState = {
  /** True while the tour card is on screen. */
  open: boolean
  /** A run is on screen: the tour does not open (and an open one closes) so a run is never disturbed. */
  disabled: boolean
  /** Opens the tour at step 1; does nothing while it is open or disabled. */
  start(): void
  close(): void
}

const TourContext = createContext<TourState | null>(null)

/** Ctrl+Shift+T by the physical key, so it works on any layout. Alt and Meta make it a different shortcut. */
function isTourKey(e: KeyboardEvent): boolean {
  return e.code === 'KeyT' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey
}

export function TourProvider({ disabled, children }: { disabled: boolean; children: ComponentChildren }): JSX.Element {
  const [open, setOpen] = useState(false)
  // The window listener and start() read the latest values here: they are set at once, the state a render later.
  const isOpen = useRef(false)
  const isDisabled = useRef(disabled)
  isDisabled.current = disabled

  const actions = useMemo(() => {
    const set = (next: boolean): void => {
      isOpen.current = next
      setOpen(next)
    }
    return {
      start: () => {
        if (!isOpen.current && !isDisabled.current) set(true)
      },
      close: () => set(false),
    }
  }, [])

  const tour = useMemo<TourState>(() => ({ open, disabled, ...actions }), [open, disabled, actions])

  // A run began under an open tour (the back button, say): the card goes away.
  useLayoutEffect(() => {
    if (disabled && isOpen.current) actions.close()
  }, [disabled, actions])

  // A layout effect, so the listener is gone synchronously at unmount. Capture phase on window, as the dock's is.
  useLayoutEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!isTourKey(e) || e.repeat || e.isComposing) return
      if (isOpen.current || isDisabled.current) return
      // Another modal dialog (ConfirmDialog) is in charge of the keys.
      if (document.querySelector('[aria-modal="true"]')) return
      e.preventDefault()
      e.stopPropagation()
      actions.start()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [actions])

  return <TourContext.Provider value={tour}>{children}</TourContext.Provider>
}

/** The tour, or null outside a provider (for chrome that should simply leave the Tour button out). */
export function useTourOptional(): TourState | null {
  return useContext(TourContext)
}
