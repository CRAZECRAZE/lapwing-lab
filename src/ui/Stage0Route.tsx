import type { JSX } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Stage0Words } from '../../scripts/lib/stage0.ts'
import type { Settings } from '../../server/settings.ts'
import { createTestLogger, getSettings, putSettings } from '../api.ts'
import { isPlainClick, navigate } from '../router.ts'
import { ROW_DRILLS, STAGE0_INFO, buildStage0Drills, itemsForRun } from '../stage0/lists.ts'
import type { Stage0Drill } from '../stage0/lists.ts'
import { Drill } from './Drill.tsx'
import type { DrillResult } from './Drill.tsx'

type Visibility = Settings['boardVisibility']
const VISIBILITY: Visibility[] = ['always', 'hover', 'hidden']

const CHAPTER_HREF = '/page/ch04'

type Words = { status: 'loading' } | { status: 'error' } | { status: 'ready'; words: Stage0Words }

function BackLink(): JSX.Element {
  return (
    <a
      href={CHAPTER_HREF}
      onClick={(e) => {
        if (!isPlainClick(e)) return
        e.preventDefault()
        navigate(CHAPTER_HREF)
      }}
    >
      Back to Chapter 4
    </a>
  )
}

function Message({ children }: { children: string }): JSX.Element {
  return (
    <div class="stage0-run">
      <p class="page__status" role="alert">{children}</p>
      <p><BackLink /></p>
    </div>
  )
}

const clock = (ms: number): string => {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function Summary({ drill, result, onAgain }: { drill: Stage0Drill; result: DrillResult; onAgain(): void }): JSX.Element {
  const { stats, passed } = result
  return (
    <section class="stage0-run stage0-summary" aria-label="Result">
      <h2 class="stage0-summary__title">{drill.title}</h2>
      {passed !== null && <p class="stage0-summary__verdict">{passed ? 'Passed' : 'Not yet'}</p>}
      {drill.passMark && (
        <p class="stage0-summary__note">
          Pass mark: {Math.round(drill.passMark.accuracy * 100)}% accuracy within {drill.passMark.maxMinutes} minutes.
        </p>
      )}
      <dl class="stage0-summary__stats">
        <div><dt>Accuracy</dt><dd>{Math.round(stats.accuracy * 100)}%</dd></div>
        <div><dt>Speed</dt><dd>{Math.round(stats.wpm)} wpm</dd></div>
        <div><dt>Time</dt><dd>{clock(stats.elapsedMs)}</dd></div>
      </dl>
      <div class="stage0-summary__actions">
        <button type="button" class="stage0-button" onClick={onAgain}>Again</button>
        <button type="button" class="stage0-button" onClick={() => navigate(CHAPTER_HREF)}>Back to Chapter 4</button>
      </div>
    </section>
  )
}

/** The `/drill/stage0/<id>` route; `id` is the part after `stage0/`. */
export function Stage0Route({ id }: { id: string }): JSX.Element {
  const known = STAGE0_INFO.some((info) => info.id === id)
  const rowDrill = ROW_DRILLS.find((d) => d.id === id)
  const [words, setWords] = useState<Words>({ status: 'loading' })
  const [visibility, setVisibility] = useState<Visibility>('always')
  const chosen = useRef(false) // the owner picked a value before the stored one arrived
  const [run, setRun] = useState(0)
  const [result, setResult] = useState<DrillResult | null>(null)

  useEffect(() => {
    let live = true
    void getSettings().then((s) => live && !chosen.current && setVisibility(s.boardVisibility))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!known || rowDrill) return
    let live = true
    setWords({ status: 'loading' })
    fetch('/content/stage0.json')
      .then(async (res): Promise<Words> => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return { status: 'ready', words: (await res.json()) as Stage0Words }
      })
      .catch((): Words => ({ status: 'error' }))
      .then((next) => live && setWords(next))
    return () => {
      live = false
    }
  }, [id])

  const drill = useMemo(
    () => rowDrill ?? (words.status === 'ready' ? buildStage0Drills(words.words).find((d) => d.id === id) : undefined),
    [id, words],
  )
  // A new attempt gets a new logger and a fresh shuffle.
  const attempt = useMemo(
    () => (drill ? { logger: createTestLogger(), items: itemsForRun(drill) } : null),
    [drill, run],
  )

  if (!known) return <Message>No such drill. Pick one from Chapter 4.</Message>
  if (!rowDrill && words.status === 'loading') return <p class="page__status">Loading…</p>
  if (!drill || !attempt) return <Message>Couldn't load the word lists. Check that the Lapwing Lab server is still running, then try again.</Message>

  const pick = (next: Visibility): void => {
    chosen.current = true
    setVisibility(next)
    putSettings({ boardVisibility: next }).catch(() => {}) // still applies for this session
  }

  if (result) {
    return (
      <Summary
        drill={drill}
        result={result}
        onAgain={() => {
          setResult(null)
          setRun((n) => n + 1)
        }}
      />
    )
  }

  return (
    <div class="stage0-run">
      <div class="stage0-visibility" role="group" aria-label="Board visibility">
        <span class="stage0-visibility__label">Board</span>
        {VISIBILITY.map((v) => (
          <button
            key={v}
            type="button"
            class="stage0-visibility__option"
            aria-pressed={visibility === v}
            onClick={() => pick(v)}
          >
            {v}
          </button>
        ))}
      </div>
      <Drill
        key={run}
        title={drill.title}
        kind="stroke"
        items={attempt.items}
        logger={attempt.logger}
        logTest={{ mode: 'stage0', chapter: 4, section: id }}
        passMark={drill.passMark}
        boardVisibility={visibility}
        onDone={setResult}
        onExit={() => navigate(CHAPTER_HREF)}
      />
    </div>
  )
}
