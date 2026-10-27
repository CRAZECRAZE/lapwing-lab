import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { KeyChartEntry, KeyChartGroup } from '../../../scripts/lib/keychart.ts'
import { SLOTS, slotMask } from '../../core/steno.ts'
import type { Slot } from '../../core/steno.ts'
import { Board } from '../Board.tsx'
import './keychart.css'

let cache: Promise<KeyChartEntry[]> | null = null
/** The chart once it has arrived, so a later open can show it in its first render. */
let loaded: KeyChartEntry[] | null = null

/** The key chart, fetched once. Only a success is kept: a failure clears the cache so the next call refetches. */
export function loadKeyChart(): Promise<KeyChartEntry[]> {
  if (cache) return cache
  const request = (async () => {
    const response = await fetch('/content/keychart.json')
    if (!response.ok) throw new Error(`/content/keychart.json: ${response.status}`)
    const body: unknown = await response.json()
    if (!Array.isArray(body)) throw new Error('/content/keychart.json: not a list')
    loaded = body as KeyChartEntry[]
    return loaded
  })()
  cache = request
  request.catch(() => {
    if (cache === request) cache = null
  })
  return request
}

export function __resetKeyChartCacheForTests(): void {
  cache = null
  loaded = null
}

type Chart = { status: 'loading' } | { status: 'error' } | { status: 'ready'; entries: KeyChartEntry[] }

function useChart(): { chart: Chart; retry(): void } {
  const [chart, setChart] = useState<Chart>(() => (loaded ? { status: 'ready', entries: loaded } : { status: 'loading' }))
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    loadKeyChart().then(
      (entries) => {
        if (live) setChart({ status: 'ready', entries })
      },
      () => {
        if (live) setChart({ status: 'error' })
      },
    )
    return () => {
      live = false
    }
  }, [attempt])
  return {
    chart,
    retry: () => {
      setChart({ status: 'loading' })
      setAttempt((n) => n + 1)
    },
  }
}

const GROUPS: ReadonlyArray<{ group: KeyChartGroup; title: string }> = [
  { group: 'left', title: 'Left hand' },
  { group: 'vowel', title: 'Vowels' },
  { group: 'right', title: 'Right hand' },
  { group: 'special', title: 'Special' },
]

/** The board mask of a chart slot; a slot the board does not know lights nothing. */
const maskOf = (slot: string): number => ((SLOTS as readonly string[]).includes(slot) ? slotMask(slot as Slot) : 0)

function Row({ entry, onHover, onFocus }: { entry: KeyChartEntry; onHover(slot: string | null): void; onFocus(slot: string | null): void }): JSX.Element {
  const special = entry.group === 'special'
  // A special key's `sounds` holds a sentence from the book, not a list of sounds, and it has no examples to show.
  const sentence = special && entry.sounds.length > 0 ? entry.sounds.join(' ') : null
  const sounds = !special && entry.sounds.length > 0 ? entry.sounds.join(' · ') : null
  const examples = !special && entry.examples.length > 0 ? entry.examples.join(', ') : null
  return (
    <li
      class="keychart__row"
      data-slot={entry.slot}
      tabIndex={0}
      onMouseEnter={() => onHover(entry.slot)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onFocus(entry.slot)}
      onBlur={() => onFocus(null)}
    >
      <kbd class="keychart__key">{entry.slot}</kbd>
      <div class="keychart__info">
        {sentence !== null && <p class="keychart__sentence">{sentence}</p>}
        {sounds !== null && <span class="keychart__sounds">{sounds}</span>}
        {examples !== null && <span class="keychart__examples">{examples}</span>}
        {sentence === null && sounds === null && examples === null && <span class="keychart__none">—</span>}
        {entry.source !== '' && <span class="keychart__source">{entry.source}</span>}
      </div>
    </li>
  )
}

export function KeyChart(): JSX.Element {
  const { chart, retry } = useChart()
  // The mouse wins over the keyboard focus while it is over a row, and the focused row shows again when it leaves.
  const [hovered, setHovered] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const active = hovered ?? focused

  let body: JSX.Element
  if (chart.status === 'loading') {
    body = (
      <p class="keychart__note" aria-live="polite">
        Loading…
      </p>
    )
  } else if (chart.status === 'error') {
    body = (
      <div class="keychart__note" aria-live="polite">
        <p>Couldn't load the key chart.</p>
        <button type="button" class="keychart__button" onClick={retry}>
          Try again
        </button>
      </div>
    )
  } else {
    body = (
      <>
        {GROUPS.map(({ group, title }) => (
          <section key={group} class="keychart__group">
            <h3 class="keychart__heading">{title}</h3>
            <ul class="keychart__list">
              {chart.entries
                .filter((e) => e.group === group)
                .map((e) => (
                  <Row key={e.slot} entry={e} onHover={setHovered} onFocus={setFocused} />
                ))}
            </ul>
          </section>
        ))}
      </>
    )
  }

  return (
    <div class="keychart">
      <div class="keychart__board">
        <Board size={28} target={active === null ? 0 : maskOf(active)} />
      </div>
      {body}
    </div>
  )
}
