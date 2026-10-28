import type { JSX } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import { createTestLogger } from '../api.ts'
import type { DrillItem } from '../core/drill.ts'
import { formatAccuracy, formatWpm } from '../core/format.ts'
import { navigate } from '../router.ts'
import { useDockDrillMarker } from '../state/dock.tsx'
import { useProgress } from '../state/progress.tsx'
import { AppLink } from './AppLink.tsx'
import { Drill } from './Drill.tsx'
import type { DrillProps, DrillResult } from './Drill.tsx'
import { HintPicker, useHints } from './HintPicker.tsx'
import { LockedNotice } from './LockedNotice.tsx'
import { QuickNote } from './QuickNote.tsx'
import { VisibilityPicker, useBoardVisibility } from './VisibilityPicker.tsx'
import './practice.css'

export type DrillRunnerProps = {
  title: string
  backHref: string
  backLabel: string
  /** The chapter the drill belongs to: its lock and its next chapter. */
  chapter: number
  /** Called once per attempt, so every run (and every Again) gets fresh items. */
  items: () => DrillItem[]
  logTest: DrillProps['logTest']
  passMark?: DrillProps['passMark']
  /** What the chapter asks for, shown under the verdict. */
  requirement?: string
  /** A quiet line above the drill. */
  intro?: string
}

/** A calm message in place of a drill, with a way back. */
export function RunnerMessage({ text, href, label }: { text: string; href: string; label: string }): JSX.Element {
  return (
    <div class="stage0-run">
      <p class="page__status" role="alert">{text}</p>
      <p><AppLink href={href}>{label}</AppLink></p>
    </div>
  )
}

const clock = (ms: number): string => {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

type ResultProps = {
  title: string
  result: DrillResult
  requirement?: string
  passMark?: DrillProps['passMark']
  backHref: string
  backLabel: string
  nextHref: string | null
  onAgain(): void
}

function RunnerResult({ title, result, requirement, passMark, backHref, backLabel, nextHref, onAgain }: ResultProps): JSX.Element {
  const { stats, passed } = result
  return (
    <section class="stage0-run stage0-summary free-result" aria-label="Result">
      <h2 class="stage0-summary__title">{title}</h2>
      {passed !== null && <p class="stage0-summary__verdict">{passed ? 'Passed' : 'Not yet'}</p>}
      {passed !== null && requirement && <p class="stage0-summary__note">{requirement}</p>}
      <dl class="stage0-summary__stats">
        <div><dt>Accuracy</dt><dd>{formatAccuracy(stats.accuracy, passMark?.accuracy)}</dd></div>
        <div><dt>Speed</dt><dd>{formatWpm(stats.wpm, passMark?.minWpm)}</dd></div>
        <div><dt>Words</dt><dd>{stats.completed}</dd></div>
        <div><dt>Time</dt><dd>{clock(stats.elapsedMs)}</dd></div>
      </dl>
      <QuickNote title={title} stats={stats.completed === 0 ? null : { accuracy: stats.accuracy, wpm: stats.wpm }} />
      <div class="stage0-summary__actions runner__actions">
        <button type="button" class="stage0-button" onClick={onAgain}>Again</button>
        <AppLink href={backHref}>{backLabel}</AppLink>
        {nextHref && <AppLink href={nextHref}>Next chapter</AppLink>}
      </div>
    </section>
  )
}

/** The shared host of a section drill or a chapter test: pickers, the word drill, the lock and the result card. */
export function DrillRunner(props: DrillRunnerProps): JSX.Element {
  const { title, backHref, backLabel, chapter, logTest, passMark, requirement, intro } = props
  // The host stays mounted from the drill to its result card: the bare dock hotkeys stay off through the swap.
  useDockDrillMarker()
  const progress = useProgress()
  const [visibility, pick] = useBoardVisibility()
  const [hints, pickHints] = useHints()
  const [run, setRun] = useState(0)
  const [result, setResult] = useState<DrillResult | null>(null)

  // A new attempt gets a new logger and fresh items. The Drill starts the logger at the first stroke.
  const attempt = useMemo(() => ({ logger: createTestLogger(), items: props.items() }), [run])

  if (result) {
    const cleared = progress.states.get(chapter)?.cleared === true
    const next = progress.chapters.find((c) => c.chapter === chapter + 1)
    return (
      <RunnerResult
        title={title}
        result={result}
        requirement={requirement}
        passMark={passMark}
        backHref={backHref}
        backLabel={backLabel}
        nextHref={cleared && next ? `/page/${next.pageId}` : null}
        onAgain={() => {
          setResult(null)
          setRun((n) => n + 1)
        }}
      />
    )
  }

  if (progress.status === 'loading') return <p class="page__status">Loading…</p>
  const state = progress.states.get(chapter)
  if (state?.locked && state.blockedBy !== undefined) return <LockedNotice chapter={chapter} blockedBy={state.blockedBy} />

  return (
    <div class="stage0-run">
      <div class="stage0-pickers">
        <VisibilityPicker value={visibility} onPick={pick} />
        <HintPicker value={hints} onPick={pickHints} />
      </div>
      {intro && <p class="runner__intro">{intro}</p>}
      <Drill
        key={run}
        title={title}
        kind="word"
        items={attempt.items}
        logger={attempt.logger}
        logTest={logTest}
        passMark={passMark}
        boardVisibility={visibility}
        hints={hints}
        onDone={(done) => {
          setResult(done)
          // Only a finished run can change a gate; leaving early never reaches here.
          void progress.reload()
        }}
        onExit={() => navigate(backHref)}
      />
    </div>
  )
}
