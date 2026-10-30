import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { PracticeList } from '../../scripts/lib/practice.ts'
import { LIST_SIZE, lastSeenText } from '../core/fixup.ts'
import type { FixupPattern, FixupWord } from '../core/fixup.ts'
import { MIN_PATTERN_WORDS, patternWords } from '../core/fixupwords.ts'
import type { ListWords } from '../core/fixupwords.ts'
import { taughtChapter } from '../core/progress.ts'
import { isPlainClick, navigate } from '../router.ts'
import { useProgress } from '../state/progress.tsx'
import { useFixup } from './useFixup.ts'
import './fixup.css'

export type Kind = 'words' | 'patterns'

/** Where a run of the ticked items starts: a `pick` query parameter per item (a prompt, or a pattern id). */
export function runHref(kind: Kind, picks: readonly string[]): string {
  const params = new URLSearchParams()
  for (const pick of picks) params.append('pick', pick)
  return `/practice/fixup/run/${kind}?${params}`
}

const NOTHING_WORDS = 'Nothing to fix here: no word has been missed often enough yet.'
const NOTHING_PATTERNS = 'Nothing to fix here: no stroke pattern has been missed often enough yet.'

const percent = (rate: number): string => `${Math.round(rate * 100)}%`

/** "-T typed for -S" or "R- missing". */
export function patternText(p: FixupPattern): string {
  return p.kind === 'mixup' ? `${p.pressed} typed for ${p.needed}` : `${p.needed} missing`
}

function lastSeen(tsMs: number): string {
  return tsMs > 0 ? lastSeenText(tsMs, Date.now()) : '—'
}

function Start({ kind, picks }: { kind: Kind; picks: readonly string[] }): JSX.Element {
  if (picks.length === 0) {
    return (
      <button type="button" class="fixup__start" disabled>
        Start slowly
      </button>
    )
  }
  const href = runHref(kind, picks)
  return (
    <a
      class="fixup__start"
      href={href}
      onClick={(e) => {
        if (!isPlainClick(e)) return
        e.preventDefault()
        navigate(href)
      }}
    >
      Start slowly
    </a>
  )
}

/** The ids of the items the owner has unticked; everything starts ticked and nothing is remembered. */
function useUnticked(): [ReadonlySet<string>, (id: string) => void] {
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string): void =>
    setUnticked((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return [unticked, toggle]
}

function Tick({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: () => void }): JSX.Element {
  return <input type="checkbox" aria-label={`Include ${label}`} checked={checked} disabled={disabled} onChange={onChange} />
}

function WordsTable({ words }: { words: readonly FixupWord[] }): JSX.Element {
  const [unticked, toggle] = useUnticked()
  const picks = words.filter((w) => !unticked.has(w.prompt)).map((w) => w.prompt)
  return (
    <>
      <div class="fixup__scroll">
        <table class="fixup__table">
          <caption>Words missed most often in the last 30 days</caption>
          <thead>
            <tr>
              <th scope="col">Include</th>
              <th scope="col">Word</th>
              <th scope="col">Outline</th>
              <th scope="col">Missed</th>
              <th scope="col">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {words.map((w) => (
              <tr key={w.prompt}>
                <td>
                  <Tick label={w.prompt} checked={!unticked.has(w.prompt)} onChange={() => toggle(w.prompt)} />
                </td>
                <th scope="row">{w.prompt}</th>
                <td class="fixup__mono">{w.outlines[0]}</td>
                <td>{percent(w.rate)}</td>
                <td>{lastSeen(w.lastTsMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Start kind="words" picks={picks} />
    </>
  )
}

export type WordLists = { status: 'loading' | 'error' } | { status: 'ready'; lists: ListWords[]; reached: number }

/** The practice lists of the chapters up to the one being taught. Any file that fails fails the lot. */
export function useWordLists(): WordLists {
  const progress = useProgress()
  const reached = taughtChapter(progress.chapters, progress.states)
  const ids = progress.index.filter((e) => e.chapter <= reached)
  const key = ids.map((e) => `${e.chapter}:${e.id}`).join('|')
  const waiting = progress.status === 'loading'
  const noIndex = progress.status === 'error' && progress.index.length === 0
  const [state, setState] = useState<WordLists>({ status: 'loading' })

  useEffect(() => {
    if (waiting) return
    if (noIndex) {
      setState({ status: 'error' })
      return
    }
    let live = true
    setState({ status: 'loading' })
    Promise.all(
      ids.map(async (entry): Promise<ListWords> => {
        const res = await fetch(`/content/practice/${encodeURIComponent(entry.id)}.json`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return { chapter: entry.chapter, items: ((await res.json()) as PracticeList).items }
      }),
    ).then(
      (lists) => live && setState({ status: 'ready', lists, reached }),
      () => live && setState({ status: 'error' }),
    )
    return () => {
      live = false
    }
  }, [key, waiting, noIndex])

  return waiting ? { status: 'loading' } : state
}

function PatternsTable({ patterns }: { patterns: readonly FixupPattern[] }): JSX.Element {
  const words = useWordLists()
  const [unticked, toggle] = useUnticked()
  const counts = useMemo(
    () => (words.status === 'ready' ? patterns.map((p) => patternWords(p.needed, words.lists, words.reached).length) : []),
    [patterns, words],
  )
  if (words.status === 'loading') return <p class="page__status">Loading…</p>
  if (words.status === 'error') {
    return <p class="page__status">Couldn't load the word lists. Check that the Lapwing Lab server is still running, then try again.</p>
  }
  const drillable = (i: number): boolean => counts[i] >= MIN_PATTERN_WORDS
  const picks = patterns.filter((p, i) => drillable(i) && !unticked.has(p.id)).map((p) => p.id)
  return (
    <>
      <div class="fixup__scroll">
        <table class="fixup__table">
          <caption>Stroke patterns missed most often in the last 30 days</caption>
          <thead>
            <tr>
              <th scope="col">Include</th>
              <th scope="col">Pattern</th>
              <th scope="col">Words</th>
              <th scope="col">Rate</th>
              <th scope="col">Count</th>
              <th scope="col">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {patterns.map((p, i) => {
              const text = patternText(p)
              return (
                <tr key={p.id}>
                  <td>
                    <Tick label={text} checked={drillable(i) && !unticked.has(p.id)} disabled={!drillable(i)} onChange={() => toggle(p.id)} />
                  </td>
                  <th scope="row">{text}</th>
                  <td>
                    {drillable(i) ? counts[i] : <span class="fixup__note">not enough words in the chapters you've reached</span>}
                  </td>
                  <td>{percent(p.rate)}</td>
                  <td>{`${p.count} of ${p.required}`}</td>
                  <td>{lastSeen(p.lastTsMs)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Start kind="patterns" picks={picks} />
    </>
  )
}

function TabLink({ href, current, children }: { href: string; current: boolean; children: string }): JSX.Element {
  return (
    <a
      class="fixup__tab"
      href={href}
      aria-current={current ? 'page' : undefined}
      onClick={(e) => {
        if (!isPlainClick(e)) return
        e.preventDefault()
        navigate(href)
      }}
    >
      {children}
    </a>
  )
}

/** The Fix-up page: the words and the stroke patterns missed most in the last 30 days, each with its own Start. */
export function Fixup({ tab }: { tab: Kind }): JSX.Element {
  const fixup = useFixup()
  let body: JSX.Element
  if (fixup.status === 'loading') body = <p class="page__status">Loading…</p>
  else if (fixup.lists === null) {
    body = <p class="page__status">Couldn't load the fix-up lists. Check that the Lapwing Lab server is still running, then try again.</p>
  } else if (tab === 'words') {
    body = fixup.lists.words.length === 0 ? <p class="page__status">{NOTHING_WORDS}</p> : <WordsTable words={fixup.lists.words.slice(0, LIST_SIZE)} />
  } else {
    body =
      fixup.lists.patterns.length === 0 ? <p class="page__status">{NOTHING_PATTERNS}</p> : <PatternsTable patterns={fixup.lists.patterns.slice(0, LIST_SIZE)} />
  }
  return (
    <div class="fixup">
      <h1 class="fixup__title">Fix-up</h1>
      <nav class="fixup__tabs" aria-label="Fix-up lists">
        <TabLink href="/practice/fixup" current={tab === 'words'}>
          Words
        </TabLink>
        <TabLink href="/practice/fixup/patterns" current={tab === 'patterns'}>
          Patterns
        </TabLink>
      </nav>
      {body}
    </div>
  )
}
