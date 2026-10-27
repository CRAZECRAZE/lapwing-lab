import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { parseOutline } from '../core/steno.ts'
import type { SlotMask } from '../core/steno.ts'
import { Board } from './Board.tsx'

const CYCLE_MS = 800

function masksOf(outline: string | null): SlotMask[] {
  if (outline === null) return []
  try {
    return parseOutline(outline)
  } catch {
    return [] // the build validates every data-stroke, but a bad one must not crash the reader
  }
}

export function StrokeInspector({ outline }: { outline: string | null }): JSX.Element {
  const masks = useMemo(() => masksOf(outline), [outline])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex(0)
    if (masks.length < 2) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % masks.length), CYCLE_MS)
    return () => clearInterval(timer)
  }, [masks])

  const current = index < masks.length ? index : 0
  return (
    <div class="inspector">
      <Board size={22} target={masks[current] ?? 0} />
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
        </p>
      )}
    </div>
  )
}
