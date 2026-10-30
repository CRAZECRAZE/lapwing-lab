import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Stage0Words } from '../../scripts/lib/stage0.ts'
import { createTestLogger } from '../api.ts'
import { formatAccuracy, formatWpm } from '../core/format.ts'
import type { ActiveGhost } from '../core/ghost.ts'
import { isPlainClick, navigate } from '../router.ts'
import { useDockDrillMarker } from '../state/dock.tsx'
import { useProgress } from '../state/progress.tsx'
import { ROW_DRILLS, STAGE0_INFO, buildStage0Drills, itemsForRun } from '../stage0/lists.ts'
import type { Stage0Drill } from '../stage0/lists.ts'
import { Drill } from './Drill.tsx'
import type { DrillResult } from './Drill.tsx'
import { GhostNote } from './GhostLine.tsx'
import { GhostPicker, useGhostChoice } from './GhostPicker.tsx'
import { QuickNote } from './QuickNote.tsx'
import { useGhost } from './useGhost.ts'
import { VisibilityPicker, useBoardVisibility } from './VisibilityPicker.tsx'

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

function Summary({
  drill,
  result,
  ghost,
  onAgain,
}: {
  drill: Stage0Drill
  result: DrillResult
  ghost: ActiveGhost | null
  onAgain(): void
}): JSX.Element {
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
        <div><dt>Accuracy</dt><dd>{formatAccuracy(stats.accuracy, drill.passMark?.accuracy)}</dd></div>
        <div><dt>Speed</dt><dd>{formatWpm(stats.wpm)}</dd></div>
        <div><dt>Time</dt><dd>{clock(stats.elapsedMs)}</dd></div>
      </dl>
      <GhostNote ghost={ghost} stats={stats} />
      <QuickNote title={drill.title} stats={stats.completed === 0 ? null : { accuracy: stats.accuracy, wpm: stats.wpm }} />
      <div class="stage0-summary__actions">
        <button type="button" class="stage0-button" onClick={onAgain}>Again</button>
        <button type="button" class="stage0-button" onClick={() => navigate(CHAPTER_HREF)}>Back to Chapter 4</button>
      </div>
    </section>
  )
}

/** The `/drill/stage0/<id>` route; `id` is the part after `stage0/`. */
export function Stage0Route({ id }: { id: string }): JSX.Element {
  // The host stays mounted from the drill to its result card: the bare dock hotkeys stay off through the swap.
  useDockDrillMarker()
  const progress = useProgress()
  const known = STAGE0_INFO.some((info) => info.id === id)
  const rowDrill = ROW_DRILLS.find((d) => d.id === id)
  const [words, setWords] = useState<Words>({ status: 'loading' })
  const [visibility, pick] = useBoardVisibility()
  const [ghostChoice, pickGhost] = useGhostChoice()
  const [run, setRun] = useState(0)
  const [result, setResult] = useState<DrillResult | null>(null)

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

  const ghost = useGhost('stage0', known ? id : null, ghostChoice, run)

  if (!known) return <Message>No such drill. Pick one from Chapter 4.</Message>
  if (!rowDrill && words.status === 'loading') return <p class="page__status">Loading…</p>
  if (!drill || !attempt) return <Message>Couldn't load the word lists. Check that the Lapwing Lab server is still running, then try again.</Message>

  if (result) {
    return (
      <Summary
        drill={drill}
        result={result}
        ghost={ghost}
        onAgain={() => {
          setResult(null)
          setRun((n) => n + 1)
        }}
      />
    )
  }

  return (
    <div class="stage0-run">
      <div class="stage0-pickers">
        <VisibilityPicker value={visibility} onPick={pick} />
        <GhostPicker value={ghostChoice} onPick={pickGhost} />
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
        ghost={ghost}
        onDone={(done) => {
          setResult(done)
          // A finished run may clear Chapter 4's gate.
          void progress.reload()
        }}
        onExit={() => navigate(CHAPTER_HREF)}
      />
    </div>
  )
}
