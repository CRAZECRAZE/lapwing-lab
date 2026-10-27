import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { LookupEntry, LookupHit, LookupSource } from '../../../scripts/lib/lookup.ts'
import { searchLookup } from '../../core/lookup.ts'
import { taughtChapter } from '../../core/progress.ts'
import { tryParseStroke } from '../../core/steno.ts'
import { useProgress } from '../../state/progress.tsx'
import { Board } from '../Board.tsx'
import './lookup.css'

/** The chapter limit that means "nothing is hidden": the book's last chapter. */
const LAST_CHAPTER = 26

let cache: Promise<LookupEntry[]> | null = null
/** The index once it has arrived, so a later open can show it in its first render. */
let loaded: LookupEntry[] | null = null

/** The lookup index, fetched once. Only a success is kept: a failure clears the cache so the next call refetches. */
export function loadLookup(): Promise<LookupEntry[]> {
  if (cache) return cache
  const request = (async () => {
    const response = await fetch('/content/lookup.json')
    if (!response.ok) throw new Error(`/content/lookup.json: ${response.status}`)
    const body: unknown = await response.json()
    if (!Array.isArray(body)) throw new Error('/content/lookup.json: not a list')
    loaded = body as LookupEntry[]
    return loaded
  })()
  cache = request
  request.catch(() => {
    if (cache === request) cache = null
  })
  return request
}

export function __resetLookupCacheForTests(): void {
  cache = null
  loaded = null
}

type Index = { status: 'loading' } | { status: 'error' } | { status: 'ready'; entries: LookupEntry[] }

function useIndex(): { index: Index; retry(): void } {
  const [index, setIndex] = useState<Index>(() => (loaded ? { status: 'ready', entries: loaded } : { status: 'loading' }))
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    loadLookup().then(
      (entries) => {
        if (live) setIndex({ status: 'ready', entries })
      },
      () => {
        if (live) setIndex({ status: 'error' })
      },
    )
    return () => {
      live = false
    }
  }, [attempt])
  return {
    index,
    retry: () => {
      setIndex({ status: 'loading' })
      setAttempt((n) => n + 1)
    },
  }
}

type Group = { outline: string; chapter: number; sources: LookupSource[]; note?: string }

const SOURCE_ORDER: readonly LookupSource[] = ['practice', 'brief', 'example']
const SOURCE_TEXT: Readonly<Record<LookupSource, string>> = { practice: 'practice list', brief: 'brief', example: 'example' }

/** One group per (outline, chapter), in the order the hits first name them, with the sources they share. */
function groupHits(hits: readonly LookupHit[]): Group[] {
  const groups = new Map<string, Group & { seen: Set<LookupSource> }>()
  for (const hit of hits) {
    const key = `${hit.chapter}\u0000${hit.outline}`
    let group = groups.get(key)
    if (!group) {
      group = { outline: hit.outline, chapter: hit.chapter, sources: [], seen: new Set() }
      groups.set(key, group)
    }
    group.seen.add(hit.source)
    if (hit.note !== undefined && group.note === undefined) group.note = hit.note
  }
  return [...groups.values()].map(({ seen, ...group }) => ({ ...group, sources: SOURCE_ORDER.filter((s) => seen.has(s)) }))
}

function Outline({ outline, onPreview }: { outline: string; onPreview(stroke: string): void }): JSX.Element {
  return (
    <span class="lookup__outline">
      {outline.split('/').map((stroke, i) => (
        <span key={i}>
          {i > 0 && <span class="lookup__slash">/</span>}
          <code class="stroke" tabIndex={0} data-stroke={stroke} onMouseOver={() => onPreview(stroke)} onFocus={() => onPreview(stroke)}>
            {stroke}
          </code>
        </span>
      ))}
    </span>
  )
}

export function Lookup(): JSX.Element {
  const progress = useProgress()
  const { index, retry } = useIndex()
  const [query, setQuery] = useState('')
  const [later, setLater] = useState(false)
  const [previewed, setPreviewed] = useState<string | null>(null)

  const limit = progress.status === 'ready' ? taughtChapter(progress.chapters, progress.states) : LAST_CHAPTER
  // Only a ready progress can give a limit below the last chapter, so `limited` also means "progress is ready".
  const limited = limit < LAST_CHAPTER
  const hidingLater = limited && !later

  const trimmed = query.trim()
  const results = useMemo(
    () => (index.status === 'ready' ? searchLookup(index.entries, query, hidingLater ? { maxChapter: limit } : {}) : []),
    [index, query, hidingLater, limit],
  )
  const shown = useMemo(() => results.map((r) => ({ word: r.word, groups: groupHits(r.hits) })), [results])

  const stroke = previewed ?? shown[0]?.groups[0]?.outline.split('/')[0] ?? null
  const previewMask = stroke === null ? null : tryParseStroke(stroke)

  const search = (text: string): void => {
    setQuery(text)
    setPreviewed(null)
  }

  let body: JSX.Element
  if (index.status === 'loading') {
    body = (
      <p class="lookup__note" aria-live="polite">
        Loading…
      </p>
    )
  } else if (index.status === 'error') {
    body = (
      <div class="lookup__note" aria-live="polite">
        <p>Couldn't load the lookup index.</p>
        <button type="button" class="lookup__button" onClick={retry}>
          Try again
        </button>
      </div>
    )
  } else if (trimmed === '') {
    body = (
      <p class="lookup__note" aria-live="polite">
        Start typing to look something up.
      </p>
    )
  } else if (shown.length === 0) {
    body = hidingLater ? (
      <div class="lookup__note" aria-live="polite">
        <p>{`Nothing found in Chapters up to ${limit}.`}</p>
        <button type="button" class="lookup__button" onClick={() => setLater(true)}>
          Include later chapters
        </button>
      </div>
    ) : (
      <p class="lookup__note" aria-live="polite">
        Nothing found.
      </p>
    )
  } else {
    body = (
      <>
        <p class="lookup__count" aria-live="polite">
          {shown.length === 1 ? '1 result' : `${shown.length} results`}
        </p>
        {previewMask !== null && (
          <div class="lookup__preview">
            <Board size={18} target={previewMask} />
            <code class="lookup__preview-stroke">{stroke}</code>
          </div>
        )}
        <ul class="lookup__results">
          {shown.map((r) => (
            <li key={r.word} class="lookup__result">
              <p class="lookup__word">{r.word}</p>
              {r.groups.map((g) => (
                <div key={`${g.chapter}-${g.outline}`} class="lookup__hit">
                  <Outline outline={g.outline} onPreview={setPreviewed} />
                  <span class="lookup__where">
                    {`Chapter ${g.chapter}`}
                    {g.chapter > limit && <span class="lookup__later">later in the book</span>}
                  </span>
                  <span class="lookup__sources">{g.sources.map((s) => SOURCE_TEXT[s]).join(', ')}</span>
                  {g.note !== undefined && <span class="lookup__hit-note">{g.note}</span>}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </>
    )
  }

  return (
    <div class="lookup">
      <label class="lookup__field">
        <span class="lookup__label">Look up a word or a stroke</span>
        <input
          type="search"
          class="lookup__input"
          data-autofocus
          autocomplete="off"
          spellcheck={false}
          value={query}
          onInput={(e) => search(e.currentTarget.value)}
        />
      </label>
      {limited && (
        <label class="lookup__later-box">
          <input type="checkbox" checked={later} onChange={(e) => setLater(e.currentTarget.checked)} />
          <span>{`Include later chapters (now: Chapters up to ${limit})`}</span>
        </label>
      )}
      <div class="lookup__results-area">{body}</div>
    </div>
  )
}
