import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { BookLabel, DictCard, DictFile, DictRow, DictionaryFile } from '../../../scripts/lib/dictionary.ts'
import { fingerspell, searchDictionary, visibleText } from '../../core/dictsearch.ts'
import type { DictResult } from '../../core/dictsearch.ts'
import { tryParseStroke } from '../../core/steno.ts'
import { Board } from '../Board.tsx'
import './lookup.css'

/** Cards shown at first, and added by each `Show more`. */
const PAGE = 30

/** The longest query that still gets a fingerspelling hint: a pasted paragraph would otherwise draw thousands of chips. */
const MAX_FINGERSPELL = 40

let cache: Promise<DictionaryFile> | null = null
/** The dictionary once it has arrived, so a later open can show it in its first render. */
let loaded: DictionaryFile | null = null

async function fetchDictionary(): Promise<DictionaryFile> {
  const response = await fetch('/content/dictionary.json')
  if (!response.ok) throw new Error(`/content/dictionary.json: ${response.status}`)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { cards?: unknown }).cards)) {
    throw new Error('/content/dictionary.json: no cards')
  }
  const { cards, letters } = body as { cards: DictCard[]; letters?: unknown }
  if (letters !== undefined && (typeof letters !== 'object' || letters === null || Array.isArray(letters))) {
    throw new Error('/content/dictionary.json: letters is not an object')
  }
  return { ...(body as DictionaryFile), cards, letters: (letters as Record<string, string> | undefined) ?? {} }
}

/** The dictionary, fetched once. Only a success is kept: a failure clears the cache so the next call refetches. */
export function loadDictionary(): Promise<DictionaryFile> {
  if (cache) return cache
  const request: Promise<DictionaryFile> = fetchDictionary().then((file) => {
    // A request that was reset away while it was in flight must not fill the mirror the next open reads.
    if (cache === request) loaded = file
    return file
  })
  cache = request
  request.catch(() => {
    if (cache === request) cache = null
  })
  return request
}

export function __resetDictionaryCacheForTests(): void {
  cache = null
  loaded = null
}

type Dictionary = { status: 'loading' } | { status: 'error' } | { status: 'ready'; file: DictionaryFile }

function useDictionary(): { dictionary: Dictionary; retry(): void } {
  const [dictionary, setDictionary] = useState<Dictionary>(() => (loaded ? { status: 'ready', file: loaded } : { status: 'loading' }))
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    loadDictionary().then(
      (file) => {
        if (live) setDictionary({ status: 'ready', file })
      },
      () => {
        if (live) setDictionary({ status: 'error' })
      },
    )
    return () => {
      live = false
    }
  }, [attempt])
  return {
    dictionary,
    retry: () => {
      setDictionary({ status: 'loading' })
      setAttempt((n) => n + 1)
    },
  }
}

const KIND_ORDER: readonly BookLabel['source'][] = ['practice', 'brief', 'example']
const KIND_TEXT: Readonly<Record<BookLabel['source'], string>> = { practice: 'practice list', brief: 'brief', example: 'example' }
const FILE_TEXT: Readonly<Record<DictFile, string>> = { main: 'main', uk: 'UK', names: 'names', numbers: 'numbers', commands: 'commands', movement: 'movement' }

type Group = { chapter: number; kinds: string; note?: string }

/** One group per chapter, in the order the labels first name them, with the kinds they share (practice list, brief, example). */
function groupLabels(labels: readonly BookLabel[]): Group[] {
  const groups = new Map<number, { seen: Set<BookLabel['source']>; note?: string }>()
  for (const label of labels) {
    let group = groups.get(label.chapter)
    if (!group) {
      group = { seen: new Set() }
      groups.set(label.chapter, group)
    }
    group.seen.add(label.source)
    if (label.note !== undefined && group.note === undefined) group.note = label.note
  }
  return [...groups].map(([chapter, { seen, note }]) => ({
    chapter,
    kinds: KIND_ORDER.filter((k) => seen.has(k))
      .map((k) => KIND_TEXT[k])
      .join(', '),
    note,
  }))
}

/**
 * Whether a heading is shown in monospace: it starts with `{` (Plover syntax) or has a character other than letters,
 * digits, spaces and the basic punctuation `.,;:'"!?()-`. Real text such as `Comma (,)` or `don't` stays normal; `{^}.sh`,
 * `{#Shift_l(Home)}`, a shown `\\n` and symbols such as `@` or `&` are code.
 */
function isCode(text: string): boolean {
  return text.startsWith('{') || !/^[\p{L}\p{N} .,;:'"!?()-]*$/u.test(text)
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

function Row({ row, named, hit, onPreview }: { row: DictRow; named: boolean; hit: boolean; onPreview(stroke: string): void }): JSX.Element {
  const written = row.w !== undefined && row.w.length > 0
  return (
    <div class={hit ? 'lookup__row lookup__row--hit' : 'lookup__row'}>
      <Outline outline={row.o} onPreview={onPreview} />
      {row.b !== undefined &&
        groupLabels(row.b).map((g) => (
          <span key={g.chapter} class="lookup__label-group">
            <span class="lookup__where">{`Chapter ${g.chapter}`}</span>
            <span class="lookup__sources">{g.kinds}</span>
            {g.note !== undefined && <span class="lookup__hit-note">{g.note}</span>}
          </span>
        ))}
      {row.f?.map((file) => (
        <span key={file} class="lookup__tag">
          {FILE_TEXT[file]}
        </span>
      ))}
      {row.x === true && <span class="lookup__book-only">book only</span>}
      {written && (
        <span class="lookup__written">
          {'The dictionary writes this outline as: '}
          {row.w?.map((w, i) => (
            <code key={i} class="lookup__w">
              {visibleText(w)}
            </code>
          ))}
        </span>
      )}
      {!written && named && <span class="lookup__written">not in the dictionary</span>}
    </div>
  )
}

function Card({ result, onPreview }: { result: DictResult; onPreview(stroke: string): void }): JSX.Element {
  const { card, hit } = result
  const heading = visibleText(card.t)
  return (
    <li class="lookup__result">
      <p class="lookup__word-line">
        <span class={isCode(heading) ? 'lookup__word lookup__word--code' : 'lookup__word'}>{heading}</span>
        {card.n === true && <span class="lookup__named">from the book</span>}
      </p>
      {card.r.map((row, i) => (
        <Row key={i} row={row} named={card.n === true} hit={hit?.has(row.o) === true} onPreview={onPreview} />
      ))}
    </li>
  )
}

export function Lookup(): JSX.Element {
  const { dictionary, retry } = useDictionary()
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(PAGE)
  const [previewed, setPreviewed] = useState<string | null>(null)

  const file = dictionary.status === 'ready' ? dictionary.file : null
  // The whole ordered list is worked out once per (data, query); the render below only touches the shown cards.
  const results = useMemo(() => (file ? searchDictionary(file.cards, query) : []), [file, query])
  const trimmed = query.trim()
  const spelled = useMemo(
    () => (file && results.length === 0 && trimmed.length <= MAX_FINGERSPELL ? fingerspell(trimmed, file.letters) : null),
    [file, results, trimmed],
  )

  // With results the board defaults to the first stroke of the first row of the first card; with none it shows only a
  // fingerspelling chip the user has pointed at.
  const stroke = previewed ?? results[0]?.card.r[0]?.o.split('/')[0] ?? null
  const previewMask = stroke === null ? null : tryParseStroke(stroke)

  const search = (text: string): void => {
    setQuery(text)
    setCount(PAGE)
    setPreviewed(null)
  }

  const preview =
    previewMask !== null ? (
      <div class="lookup__preview">
        <Board size={18} target={previewMask} />
        <code class="lookup__preview-stroke">{stroke}</code>
      </div>
    ) : null

  let body: JSX.Element
  if (dictionary.status === 'loading') {
    body = (
      <p class="lookup__note" aria-live="polite">
        Loading…
      </p>
    )
  } else if (dictionary.status === 'error') {
    body = (
      <div class="lookup__note" aria-live="polite">
        <p>Couldn't load the dictionary.</p>
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
  } else if (results.length === 0) {
    body = (
      <>
        <p class="lookup__note" aria-live="polite">
          Not in the dictionary.
        </p>
        {spelled !== null && (
          <p class="lookup__note lookup__fingerspell">
            {'Fingerspell it: '}
            {spelled.map((outline, i) => (
              <Outline key={i} outline={outline} onPreview={setPreviewed} />
            ))}
          </p>
        )}
        {preview}
      </>
    )
  } else {
    body = (
      <>
        <p class="lookup__count" aria-live="polite">
          {results.length === 1 ? '1 result' : `${results.length} results`}
        </p>
        {preview}
        <ul class="lookup__results">
          {results.slice(0, count).map((result, i) => (
            <Card key={`${i}\u0000${result.card.t}`} result={result} onPreview={setPreviewed} />
          ))}
        </ul>
        {count < results.length && (
          <button type="button" class="lookup__button lookup__more" onClick={() => setCount((n) => n + PAGE)}>
            Show more
          </button>
        )}
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
      <div class="lookup__results-area">
        {body}
      </div>
    </div>
  )
}
