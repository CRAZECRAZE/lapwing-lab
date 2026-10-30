import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { PracticeIndexEntry } from '../../scripts/build-content.ts'
import type { TestRow } from '../../server/archive.ts'
import { getLastTest } from '../api.ts'
import { currentChapter } from '../core/progress.ts'
import type { Routine } from '../core/routine.ts'
import {
  FREE_MODES,
  MAX_CUSTOM_SECONDS,
  MAX_CUSTOM_WORDS,
  MIN_CUSTOM_SECONDS,
  PSEUDO_SOURCE,
  customModeId,
  sourcesFor,
} from '../freetype/free.ts'
import type { FreeSource } from '../freetype/free.ts'
import { isPlainClick, navigate } from '../router.ts'
import { useProgress } from '../state/progress.tsx'
import { AppLink } from './AppLink.tsx'
import { ChapterPanel } from './ChapterPanel.tsx'
import { Stage0Panel } from './Stage0Panel.tsx'
import { useFixup } from './useFixup.ts'
import { useRoutineToday, useRoutines } from './useRoutines.ts'
import './practice.css'

/** The quiet "last time" text for one free-type combination. */
function describeLast(row: TestRow | null): string {
  if (row === null || row.accuracy === null) return 'Last: —'
  return `Last: ${Math.round(row.accuracy * 100)}% · ${Math.round(row.wpm ?? 0)} wpm`
}

const CUSTOM = 'custom'
type Unit = 'words' | 'seconds'

/** The typed amount as a whole number, or NaN for anything that is not plain digits. */
const typedAmount = (text: string): number => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN)

const rangeHint = (unit: Unit): string => (unit === 'words' ? `1–${MAX_CUSTOM_WORDS} words` : `${MIN_CUSTOM_SECONDS}–${MAX_CUSTOM_SECONDS} seconds`)

function FreeType(): JSX.Element {
  // Until (or unless) the index loads, the pseudo-words are the only source.
  const [sources, setSources] = useState<FreeSource[]>([PSEUDO_SOURCE])
  const [source, setSource] = useState(PSEUDO_SOURCE.id)
  const [mode, setMode] = useState(FREE_MODES[0].id)
  const [last, setLast] = useState<{ section: string; row: TestRow | null } | null>(null)
  // What was typed in the Custom box is kept while a preset is chosen, so going back finds it again.
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<Unit>('words')
  const custom = mode === CUSTOM
  const modeId = custom ? customModeId(unit, typedAmount(amount)) : mode
  const invalid = custom && modeId === undefined
  const section = modeId === undefined ? null : `${source}/${modeId}`
  const href = section === null ? null : `/practice/free/${section}`
  const go = (): void => {
    if (href !== null) navigate(href)
  }

  useEffect(() => {
    let live = true
    fetch('/content/practice-index.json')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return sourcesFor((await res.json()) as PracticeIndexEntry[])
      })
      .catch(() => [PSEUDO_SOURCE])
      .then((next) => live && setSources(next))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (section === null) return
    let live = true
    void getLastTest('free', section).then((row) => live && setLast({ section, row }))
    return () => {
      live = false
    }
  }, [section])

  return (
    <section class="practice__box free-type" aria-labelledby="free-type-heading">
      <h2 id="free-type-heading" class="practice__heading">Free type</h2>
      <div class="free-type__form">
        <label class="free-type__source">
          <span class="free-type__label">Words from</span>
          <select value={source} onChange={(e) => setSource((e.currentTarget as HTMLSelectElement).value)}>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <div class="free-type__modes" role="radiogroup" aria-labelledby="free-type-mode">
          <span id="free-type-mode" class="free-type__label">Mode</span>
          {[...FREE_MODES, { id: CUSTOM, label: 'Custom' }].map((m) => (
            <label key={m.id} class="free-type__mode">
              <input
                type="radio"
                name="free-type-mode"
                value={m.id}
                checked={mode === m.id}
                onChange={() => setMode(m.id)}
              />
              {m.label}
            </label>
          ))}
        </div>
        {custom && (
          <div class="free-type__custom">
            <label class="free-type__amount">
              <span class="free-type__label">Amount</span>
              <input
                type="number"
                inputMode="numeric"
                step={1}
                min={unit === 'words' ? 1 : MIN_CUSTOM_SECONDS}
                max={unit === 'words' ? MAX_CUSTOM_WORDS : MAX_CUSTOM_SECONDS}
                value={amount}
                aria-invalid={invalid && amount !== '' ? 'true' : undefined}
                aria-describedby="free-type-range"
                onInput={(e) => setAmount((e.currentTarget as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  go()
                }}
              />
            </label>
            <div class="free-type__units" role="radiogroup" aria-label="Unit">
              {(['words', 'seconds'] as const).map((u) => (
                <label key={u} class="free-type__mode">
                  <input type="radio" name="free-type-unit" value={u} checked={unit === u} onChange={() => setUnit(u)} />
                  {u}
                </label>
              ))}
            </div>
            <p id="free-type-range" class="free-type__hint">{rangeHint(unit)}</p>
          </div>
        )}
        <div class="free-type__go">
          {href === null ? (
            <button type="button" class="free-type__start" disabled>
              Start
            </button>
          ) : (
            <a
              class="free-type__start"
              href={href}
              onClick={(e) => {
                if (!isPlainClick(e)) return
                e.preventDefault()
                navigate(href)
              }}
            >
              Start
            </a>
          )}
          <span class="free-type__last">{describeLast(section !== null && last?.section === section ? last.row : null)}</span>
        </div>
      </div>
    </section>
  )
}

/** The chapter the owner is on, with its panel and a way back to its page. Nothing until progress has loaded. */
function WhereYouAre(): JSX.Element | null {
  const progress = useProgress()
  if (progress.status !== 'ready' || progress.chapters.length === 0) return null
  const number = currentChapter(progress.chapters, progress.states)
  const info = progress.chapters.find((c) => c.chapter === number)
  if (!info) return null
  const href = `/page/${info.pageId}`
  return (
    <section class="practice__where" aria-labelledby="where-heading">
      <h2 id="where-heading" class="practice__heading">Where you are</h2>
      <p class="practice__where-title">{info.title}</p>
      <ChapterPanel chapter={number} />
      <a
        class="practice__where-go"
        href={href}
        onClick={(e) => {
          if (!isPlainClick(e)) return
          e.preventDefault()
          navigate(href)
        }}
      >
        {`Go to Chapter ${number}`}
      </a>
    </section>
  )
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/** The fix-up card: how much there is to fix, and the way in. Numbers only once the lists have loaded. */
function FixupCard(): JSX.Element {
  const fixup = useFixup()
  const lists = fixup.status === 'ready' ? fixup.lists : null
  const empty = lists !== null && lists.words.length === 0 && lists.patterns.length === 0
  return (
    <section class="practice__box fixup-card" aria-labelledby="fixup-card-heading">
      <h2 id="fixup-card-heading" class="practice__heading">Fix-up</h2>
      {lists !== null && (
        <p class="fixup-card__count">
          {empty ? 'Nothing to fix right now.' : `${plural(lists.words.length, 'word')}, ${plural(lists.patterns.length, 'pattern')} to fix`}
        </p>
      )}
      <p class="fixup-card__go">
        <AppLink href="/practice/fixup">Open fix-up</AppLink>
      </p>
    </section>
  )
}

/** The real-text card: a way to practise a text of your own. */
function RealTextCard(): JSX.Element {
  return (
    <section class="practice__box fixup-card" aria-labelledby="real-text-heading">
      <h2 id="real-text-heading" class="practice__heading">Real text</h2>
      <p class="fixup-card__count">Practise words from a text you paste or save.</p>
      <p class="fixup-card__go">
        <AppLink href="/practice/text">Open real text</AppLink>
      </p>
    </section>
  )
}

/** The count line for the active routine; only once today's tests have loaded. */
function RoutineCount({ routine }: { routine: Routine }): JSX.Element | null {
  const today = useRoutineToday(routine.steps)
  if (routine.steps.length === 0) return <p class="fixup-card__count">No steps yet.</p>
  if (today.tests !== 'ready') return null
  return <p class="fixup-card__count">{`${today.done.filter(Boolean).length} of ${routine.steps.length} done today`}</p>
}

/** The routine card: the active routine and how much of it is done today, and the way in. Nothing but the link if it will not load. */
function RoutineCard(): JSX.Element {
  const { status, doc } = useRoutines()
  const active = doc.routines.find((r) => r.id === doc.active)
  const none = status === 'ready' && !active
  return (
    <section class="practice__box fixup-card" aria-labelledby="routine-card-heading">
      <h2 id="routine-card-heading" class="practice__heading">Routine</h2>
      {active && (
        <>
          <p class="fixup-card__count">{active.name}</p>
          <RoutineCount routine={active} />
        </>
      )}
      {none && <p class="fixup-card__count">{doc.routines.length === 0 ? 'No routine yet.' : 'No routine is active.'}</p>}
      <p class="fixup-card__go">
        <AppLink href="/practice/routine">{none && doc.routines.length === 0 ? 'Plan a routine' : 'Open routine'}</AppLink>
      </p>
    </section>
  )
}

/** The Practice tab: where you are, fix-up, free type, real text, then the Chapter 4 drills. */
export function Practice(): JSX.Element {
  return (
    <div class="practice">
      <h1 class="practice__title">Practice</h1>
      <WhereYouAre />
      <FixupCard />
      <FreeType />
      <RealTextCard />
      <RoutineCard />
      {/* The panel brings its own heading ("Practice — Stage 0"); the region name says where it sits. */}
      <section class="practice__drills" aria-label="Chapter 4 drills">
        <Stage0Panel />
      </section>
    </div>
  )
}
