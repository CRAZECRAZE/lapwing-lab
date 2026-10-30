import type { JSX } from 'preact'
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useTourOptional } from '../state/tour.tsx'
import { TOUR_STEPS } from './tourSteps.ts'
import './tour.css'

/** Room, in px, between the ringed element and its ring. */
const RING_GAP = 3

type Box = { top: number; left: number; width: number; height: number }

/** The ring's box around the element `selector` matches, kept current on resize and scroll; null when none matches. */
function useRing(selector: string | undefined): Box | null {
  const [box, setBox] = useState<Box | null>(null)
  useLayoutEffect(() => {
    const measure = (): void => {
      const el = selector ? document.querySelector(selector) : null
      if (!el) return setBox(null)
      const r = el.getBoundingClientRect()
      const next = {
        top: r.top - RING_GAP,
        left: r.left - RING_GAP,
        width: r.width + 2 * RING_GAP,
        height: r.height + 2 * RING_GAP,
      }
      // Scrolling fires often: keep the old object (no render) while nothing moved.
      setBox((was) => (was && was.top === next.top && was.left === next.left && was.width === next.width && was.height === next.height ? was : next))
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true) // capture: any scrolling ancestor counts
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [selector])
  return box
}

/**
 * The quick tour: a dimmed backdrop and one card that steps through TOUR_STEPS. The tour never changes the page; a
 * step may ring an element of it. Focus starts on Next and Tab stays inside, as in ConfirmDialog; Esc skips, the
 * arrow keys go back and forth. The keys are taken on window, so they keep working if a click leaves the focus on
 * the page. A modal, so the dock's own keys step aside (see DockProvider).
 */
export function Tour({ onClose }: { onClose(): void }): JSX.Element {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const nextButton = useRef<HTMLButtonElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const [index, setIndex] = useState(0)
  const step = TOUR_STEPS[index]
  const last = index === TOUR_STEPS.length - 1
  const ring = useRing(step.target)

  // Layout effects so the focus moves, and comes back, in the same commit that opens or closes the card.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    nextButton.current?.focus()
    return () => {
      if (opener && opener.isConnected) opener.focus()
    }
  }, [])

  // The button that had the focus can go (Back on step 1, Skip on the last): Next takes it.
  useLayoutEffect(() => {
    if (!panel.current?.contains(document.activeElement)) nextButton.current?.focus()
  }, [index])

  useLayoutEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close.current()
        return
      }
      // A held Enter would press the focused button over and over, and run through the steps.
      if (e.key === 'Enter' && e.repeat) {
        e.preventDefault()
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        // Alt+Arrow and Ctrl+Arrow are the browser's; a held key moves one step only.
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        const by = e.key === 'ArrowRight' ? 1 : -1
        setIndex((i) => Math.min(Math.max(i + by, 0), TOUR_STEPS.length - 1))
        return
      }
      if (e.key !== 'Tab') return
      e.preventDefault()
      const buttons = Array.from(panel.current?.querySelectorAll('button') ?? [])
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const by = e.shiftKey ? -1 : 1
      const to = at === -1 ? (e.shiftKey ? buttons.length - 1 : 0) : (at + by + buttons.length) % buttons.length
      buttons[to]?.focus()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  return (
    <div class={ring ? 'tour tour--aimed' : 'tour'}>
      {ring && (
        <div
          class="tour__ring"
          aria-hidden="true"
          style={{ top: `${ring.top}px`, left: `${ring.left}px`, width: `${ring.width}px`, height: `${ring.height}px` }}
        />
      )}
      <div
        ref={panel}
        class="tour__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        tabIndex={-1}
      >
        {/* One polite region, so a screen reader reads the new step while the focus stays on Next. */}
        <div aria-live="polite">
          <p class="tour__count">{`Step ${index + 1} of ${TOUR_STEPS.length}`}</p>
          <h2 id={`${id}-title`} class="tour__title">
            {step.title}
          </h2>
          <p id={`${id}-body`} class="tour__body">
            {step.body}
          </p>
        </div>
        <div class="tour__footer">
          <div class="tour__dots" aria-hidden="true">
            {TOUR_STEPS.map((s, i) => (
              <span key={s.id} class={i === index ? 'tour__dot tour__dot--here' : 'tour__dot'} />
            ))}
          </div>
          <div class="tour__actions">
            {!last && (
              <button type="button" class="stage0-button tour__skip" onClick={() => close.current()}>
                Skip
              </button>
            )}
            {index > 0 && (
              <button type="button" class="stage0-button" onClick={() => setIndex(index - 1)}>
                Back
              </button>
            )}
            <button
              ref={nextButton}
              type="button"
              class="stage0-button tour__next"
              onClick={() => (last ? close.current() : setIndex(index + 1))}
            >
              {last ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The tour card while the tour is open; nothing outside a TourProvider. */
export function TourHost(): JSX.Element | null {
  const tour = useTourOptional()
  return tour?.open ? <Tour onClose={tour.close} /> : null
}
