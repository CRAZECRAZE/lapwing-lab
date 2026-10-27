import type { JSX } from 'preact'
import { useLayoutEffect, useMemo, useReducer } from 'preact/hooks'
import { diffMasks } from '../core/drill.ts'
import { parseOutline, slotMask } from '../core/steno.ts'
import type { SlotMask } from '../core/steno.ts'
import { useUni } from '../state/uni-context.tsx'
import { Board } from './Board.tsx'

const CYCLE_MS = 800
const FLASH_MS = 600 // how long a ✓ or a mistake overlay stays
/** Mid-sequence = from the first correct press until completion or this much inactivity, then cycling resumes from 1/n. */
const IDLE_MS = 3000

function masksOf(outline: string | null): SlotMask[] {
  if (outline === null) return []
  try {
    return parseOutline(outline)
  } catch {
    return [] // the build validates every data-stroke, but a bad one must not crash the reader
  }
}

type Flash = {
  /** The stroke that produced it; a new press is a new flash, which restarts the 600 ms. */
  id: number
  kind: 'ok' | 'bad'
  /** ok: the outline is complete, so the display returns to stroke 1 when the flash ends. */
  done: boolean
  diff?: { missing: SlotMask; extra: SlotMask }
}

/** Everything here belongs to one outline: a different outline always starts from `fresh`. */
type View = {
  outline: string | null
  index: number
  flash: Flash | null
  /** The owner has pressed a correct stroke and is working through the outline: no auto-cycling. */
  engaged: boolean
  /** Counts presses, so each one re-arms the timers. */
  presses: number
}

type Action =
  | { type: 'reset'; outline: string | null }
  | { type: 'cycle'; outline: string | null; count: number }
  | { type: 'stroke'; outline: string | null; masks: readonly SlotMask[]; mask: SlotMask }
  | { type: 'flashEnd'; outline: string | null; id: number }
  | { type: 'idle'; outline: string | null }

const fresh = (outline: string | null): View => ({ outline, index: 0, flash: null, engaged: false, presses: 0 })

function reduce(state: View, action: Action): View {
  const view = state.outline === action.outline ? state : fresh(action.outline)
  switch (action.type) {
    case 'reset':
      return fresh(action.outline)
    case 'cycle':
      return { ...view, index: (view.index + 1) % action.count }
    case 'idle':
      return fresh(action.outline)
    case 'flashEnd':
      if (view.flash?.id !== action.id) return view
      return { ...view, flash: null, index: view.flash.done ? 0 : view.index }
    case 'stroke': {
      const { masks, mask } = action
      const expected = masks[view.index]
      if (expected === undefined) return view
      const id = view.presses + 1
      if (mask !== expected) {
        const diff = diffMasks(expected, mask)
        const flash: Flash = {
          id,
          kind: 'bad',
          done: false,
          diff: { missing: slotMask(...diff.missing), extra: slotMask(...diff.extra) },
        }
        return { ...view, flash, presses: id }
      }
      const done = view.index === masks.length - 1
      return {
        ...view,
        index: done ? view.index : view.index + 1,
        flash: { id, kind: 'ok', done },
        engaged: !done,
        presses: id,
      }
    }
  }
}

export function StrokeInspector({ outline }: { outline: string | null }): JSX.Element {
  const masks = useMemo(() => masksOf(outline), [outline])
  const uni = useUni()
  const [state, dispatch] = useReducer(reduce, outline, fresh)
  // A different outline always renders from stroke 1 with nothing carried over, with no stale frame.
  const view = state.outline === outline ? state : fresh(outline)
  const current = view.index < masks.length ? view.index : 0
  const { flash, engaged, presses } = view

  // Layout effects throughout: their cleanups run synchronously at unmount and on change
  // (useEffect cleanups are deferred), so no timer fires and no stroke lands on a stale outline.
  useLayoutEffect(() => {
    dispatch({ type: 'reset', outline })
  }, [outline])

  useLayoutEffect(() => {
    if (masks.length === 0) return
    return uni.onStroke((stroke) => dispatch({ type: 'stroke', outline, masks, mask: stroke.mask }))
  }, [uni.onStroke, outline, masks])

  // Auto-cycle, but not while the owner is mid-sequence or a flash is on the board.
  useLayoutEffect(() => {
    if (masks.length < 2 || engaged || flash) return
    const timer = setInterval(() => dispatch({ type: 'cycle', outline, count: masks.length }), CYCLE_MS)
    return () => clearInterval(timer)
  }, [outline, masks, engaged, flash])

  useLayoutEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => dispatch({ type: 'flashEnd', outline, id: flash.id }), FLASH_MS)
    return () => clearTimeout(timer)
  }, [outline, flash])

  useLayoutEffect(() => {
    if (!engaged) return
    const timer = setTimeout(() => dispatch({ type: 'idle', outline }), IDLE_MS)
    return () => clearTimeout(timer)
  }, [outline, engaged, presses])

  const confirmed = flash?.kind === 'ok'
  return (
    <div class={confirmed ? 'inspector confirmed' : 'inspector'}>
      <Board size={22} target={masks[current] ?? 0} diff={flash?.diff} />
      {masks.length === 0 ? (
        <p class="inspector__hint">Hover or focus a stroke in the text to see it on the board.</p>
      ) : (
        <p class="inspector__notation">
          {outline!.split('/').map((stroke, i) => (
            <span key={i}>
              {i > 0 && <span class="inspector__slash">/</span>}
              <span class={i === current ? 'inspector__stroke inspector__stroke--current' : 'inspector__stroke'}>{stroke}</span>
            </span>
          ))}
          {masks.length > 1 && <span class="inspector__count">{`${current + 1}/${masks.length}`}</span>}
          {confirmed && <span class="inspector__check">✓</span>}
        </p>
      )}
    </div>
  )
}
