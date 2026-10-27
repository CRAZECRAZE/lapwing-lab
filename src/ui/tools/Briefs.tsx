import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { BriefRow } from '../../../scripts/lib/tables.ts'
import { taughtChapter } from '../../core/progress.ts'
import { useProgress } from '../../state/progress.tsx'
import './briefs.css'

/** The chapter limit that means "nothing is hidden": the book's last chapter. */
const LAST_CHAPTER = 26

let cache: Promise<BriefRow[]> | null = null
/** The list once it has arrived, so a later open can show it in its first render. */
let loaded: BriefRow[] | null = null

async function fetchBriefs(): Promise<BriefRow[]> {
  const response = await fetch('/content/briefs.json')
  if (!response.ok) throw new Error(`/content/briefs.json: ${response.status}`)
  const body: unknown = await response.json()
  if (!Array.isArray(body)) throw new Error('/content/briefs.json: not a list')
  return body as BriefRow[]
}

/** The briefs, fetched once. Only a success is kept: a failure clears the cache so the next call refetches. */
export function loadBriefs(): Promise<BriefRow[]> {
  if (cache) return cache
  const request: Promise<BriefRow[]> = fetchBriefs().then((rows) => {
    // A request that was reset away while it was in flight must not fill the mirror the next open reads.
    if (cache === request) loaded = rows
    return rows
  })
  cache = request
  request.catch(() => {
    if (cache === request) cache = null
  })
  return request
}

export function __resetBriefsCacheForTests(): void {
  cache = null
  loaded = null
}

type Briefs = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: BriefRow[] }

function useBriefs(): { briefs: Briefs; retry(): void } {
  const [briefs, setBriefs] = useState<Briefs>(() => (loaded ? { status: 'ready', rows: loaded } : { status: 'loading' }))
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    loadBriefs().then(
      (rows) => {
        if (live) setBriefs({ status: 'ready', rows })
      },
      () => {
        if (live) setBriefs({ status: 'error' })
      },
    )
    return () => {
      live = false
    }
  }, [attempt])
  return {
    briefs,
    retry: () => {
      setBriefs({ status: 'loading' })
      setAttempt((n) => n + 1)
    },
  }
}

/** Whether a row has the (lower-cased, trimmed) text in its translation, in any outline or in its explanation. */
function matches(row: BriefRow, needle: string): boolean {
  if (needle === '') return true
  return (
    row.translation.toLowerCase().includes(needle) ||
    row.outlines.some((o) => o.toLowerCase().includes(needle)) ||
    row.explanation.toLowerCase().includes(needle)
  )
}

type Group = { chapter: number; rows: BriefRow[] }

/** The rows by chapter, chapters ascending, each chapter's rows in file order. */
function groupByChapter(rows: readonly BriefRow[]): Group[] {
  const groups = new Map<number, BriefRow[]>()
  for (const row of rows) {
    const list = groups.get(row.chapter)
    if (list) list.push(row)
    else groups.set(row.chapter, [row])
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([chapter, list]) => ({ chapter, rows: list }))
}

/** One outline: a chip per stroke, with a slash between the strokes. */
function Outline({ outline }: { outline: string }): JSX.Element {
  return (
    <span class="briefs__outline">
      {outline.split('/').map((stroke, i) => (
        <span key={i}>
          {i > 0 && <span class="briefs__slash">/</span>}
          <code class="stroke" tabIndex={0} data-stroke={stroke}>
            {stroke}
          </code>
        </span>
      ))}
    </span>
  )
}

function Brief({ row }: { row: BriefRow }): JSX.Element {
  return (
    <li class="briefs__row">
      <div class="briefs__head">
        <strong class="briefs__translation">{row.translation}</strong>
        {row.kind === 'extra' && <span class="briefs__extra">extra</span>}
      </div>
      <div class="briefs__outlines">
        {row.outlines.map((outline, i) => (
          <span key={i} class="briefs__alternative">
            {i > 0 && <span class="briefs__or">or</span>}
            <Outline outline={outline} />
          </span>
        ))}
      </div>
      <p class="briefs__explanation">{row.explanation}</p>
    </li>
  )
}

export function Briefs(): JSX.Element {
  const progress = useProgress()
  const { briefs, retry } = useBriefs()
  const [query, setQuery] = useState('')
  const [later, setLater] = useState(false)

  const limit = progress.status === 'ready' ? taughtChapter(progress.chapters, progress.states) : LAST_CHAPTER
  // Only a ready progress can give a limit below the last chapter, so `limited` also means "progress is ready".
  const limited = limit < LAST_CHAPTER
  const hidingLater = limited && !later

  const needle = query.trim().toLowerCase()
  const { shown, hidden } = useMemo(() => {
    if (briefs.status !== 'ready') return { shown: [] as BriefRow[], hidden: 0 }
    const found = briefs.rows.filter((row) => matches(row, needle))
    const kept = hidingLater ? found.filter((row) => row.chapter <= limit) : found
    return { shown: kept, hidden: found.length - kept.length }
  }, [briefs, needle, hidingLater, limit])
  const groups = useMemo(() => groupByChapter(shown), [shown])

  const includeLater = (
    <button type="button" class="briefs__button" onClick={() => setLater(true)}>
      Include later chapters
    </button>
  )

  let body: JSX.Element
  if (briefs.status === 'loading') {
    body = (
      <p class="briefs__note" aria-live="polite">
        Loading…
      </p>
    )
  } else if (briefs.status === 'error') {
    body = (
      <div class="briefs__note" aria-live="polite">
        <p>Couldn't load the briefs.</p>
        <button type="button" class="briefs__button" onClick={retry}>
          Try again
        </button>
      </div>
    )
  } else if (shown.length === 0) {
    body = (
      <div class="briefs__note" aria-live="polite">
        <p>{needle === '' && hidden > 0 ? `No briefs yet in Chapters up to ${limit}.` : 'No briefs match.'}</p>
        {hidden > 0 && includeLater}
      </div>
    )
  } else {
    const count = shown.length === 1 ? '1 brief' : `${shown.length} briefs`
    body = (
      <>
        <p class="briefs__count" aria-live="polite">
          {hidden > 0 ? `${count} (${hidden} in later chapters hidden)` : count}
        </p>
        {groups.map((group) => (
          <section key={group.chapter} class="briefs__group">
            <h3 class="briefs__heading">{`Chapter ${group.chapter}`}</h3>
            <ul class="briefs__list">
              {group.rows.map((row, i) => (
                <Brief key={i} row={row} />
              ))}
            </ul>
          </section>
        ))}
      </>
    )
  }

  return (
    <div class="briefs">
      <label class="briefs__field">
        <span class="briefs__label">Filter briefs</span>
        <input
          type="search"
          class="briefs__input"
          data-autofocus
          autocomplete="off"
          spellcheck={false}
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </label>
      {limited && (
        <label class="briefs__later-box">
          <input type="checkbox" checked={later} onChange={(e) => setLater(e.currentTarget.checked)} />
          <span>{`Include later chapters (now: Chapters up to ${limit})`}</span>
        </label>
      )}
      <div class="briefs__results-area">{body}</div>
    </div>
  )
}
