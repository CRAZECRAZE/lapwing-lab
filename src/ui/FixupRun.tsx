import type { JSX } from 'preact'
import { useMemo, useRef, useState } from 'preact/hooks'
import { createTestLogger } from '../api.ts'
import type { DrillItem } from '../core/drill.ts'
import { FIXED_STREAK, LIST_SIZE, itemKind, patternId } from '../core/fixup.ts'
import type { FixupLists } from '../core/fixup.ts'
import { FIXUP_MAX_SHOWINGS, FixupSession } from '../core/fixupdrill.ts'
import type { FixupTarget } from '../core/fixupdrill.ts'
import { MIN_PATTERN_WORDS, patternWords } from '../core/fixupwords.ts'
import type { ListWords } from '../core/fixupwords.ts'
import { FIXUP_MODE } from '../core/runmodes.ts'
import { navigate } from '../router.ts'
import { shuffle } from '../stage0/lists.ts'
import { useDockDrillMarker } from '../state/dock.tsx'
import { useProgress } from '../state/progress.tsx'
import { AppLink } from './AppLink.tsx'
import { Drill } from './Drill.tsx'
import type { DrillResult } from './Drill.tsx'
import { clock as formatClock, RunnerMessage } from './DrillRunner.tsx'
import { patternText, useWordLists } from './Fixup.tsx'
import type { Kind } from './Fixup.tsx'
import { HintPicker, useHints } from './HintPicker.tsx'
import { QuickNote } from './QuickNote.tsx'
import { VisibilityPicker, useBoardVisibility } from './VisibilityPicker.tsx'
import { useFixup } from './useFixup.ts'
import './practice.css'
import './fixup.css'

const backHref = (kind: Kind): string => (kind === 'words' ? '/practice/fixup' : '/practice/fixup/patterns')
const BACK_LABEL = 'Back to Fix-up'

const item = (prompt: string, outlines: readonly string[]): DrillItem => ({ prompt, outlines: [...outlines], kind: itemKind(prompt, outlines) })

/** The ticked words still on the list, in the list's order; each is one item. */
function wordTargets(lists: FixupLists, picks: readonly string[]): FixupTarget[] {
  const ticked = new Set(picks)
  return lists.words
    .slice(0, LIST_SIZE)
    .filter((w) => ticked.has(w.prompt))
    .map((w) => ({ id: w.prompt, label: w.prompt, items: [item(w.prompt, w.outlines)] }))
}

/** The ticked patterns still on the list, in the list's order, each with its words shuffled once; too few words skips it. */
function patternTargets(lists: FixupLists, picks: readonly string[], words: readonly ListWords[], reached: number): FixupTarget[] {
  const ticked = new Set(picks)
  const out: FixupTarget[] = []
  for (const p of lists.patterns.slice(0, LIST_SIZE)) {
    if (!ticked.has(patternId(p))) continue
    const found = patternWords(p.needed, words, reached)
    if (found.length < MIN_PATTERN_WORDS) continue
    out.push({ id: p.id, label: patternText(p), items: shuffle(found).map((w) => item(w.prompt, w.outlines)) })
  }
  return out
}

function Status({ session }: { session: FixupSession }): JSX.Element {
  const p = session.progress()
  return (
    <div class="fixup-run__status">
      <p class="fixup-run__label">{p.target?.label}</p>
      <p class="fixup-run__position">{`Item ${p.position} of ${p.total} · ${p.fixed} fixed`}</p>
      <div class="fixup-run__dots" aria-hidden="true">
        {Array.from({ length: FIXED_STREAK }, (_, i) => (
          <span key={i} class={i < p.streak ? 'fixup-run__dot fixup-run__dot--filled' : 'fixup-run__dot'} />
        ))}
      </div>
      <p class="fixup-run__streak" aria-live="polite">{`${p.streak} clean in a row`}</p>
    </div>
  )
}

/** What a finished round leaves for its result card. */
type Finished = { result: DrillResult; round: readonly FixupTarget[]; fixed: readonly string[]; capped: boolean }

function Result({ kind, finished, onKeepGoing }: { kind: Kind; finished: Finished; onKeepGoing(): void }): JSX.Element {
  const { stats } = finished.result
  const title = `Fix-up · ${kind}`
  const left = finished.round.length - finished.fixed.length
  return (
    <section class="stage0-run stage0-summary free-result fixup-run__summary" aria-label="Result">
      <h2 class="stage0-summary__title">{title}</h2>
      {finished.capped && <p class="stage0-summary__note">{`Stopped at ${FIXUP_MAX_SHOWINGS} showings.`}</p>}
      <dl class="stage0-summary__stats">
        <div><dt>Fixed</dt><dd>{finished.fixed.length}</dd></div>
        <div><dt>Not finished</dt><dd>{left}</dd></div>
        <div><dt>Showings</dt><dd>{stats.completed}</dd></div>
        <div><dt>First try</dt><dd>{stats.completed === 0 ? '—' : `${Math.round(stats.accuracy * 100)}%`}</dd></div>
        <div><dt>Time</dt><dd>{formatClock(stats.elapsedMs)}</dd></div>
      </dl>
      {/* No stats: the journal heading must carry no percentage or wpm for a fix-up run. */}
      <QuickNote title={title} stats={null} />
      <div class="stage0-summary__actions runner__actions">
        {left > 0 && (
          <button type="button" class="stage0-button" onClick={onKeepGoing}>Keep going</button>
        )}
        <AppLink href={backHref(kind)}>{BACK_LABEL}</AppLink>
      </div>
    </section>
  )
}

/** The pickers, the Focus drill and the result card for targets that are ready. */
function RunHost({ kind, targets }: { kind: Kind; targets: readonly FixupTarget[] }): JSX.Element {
  // The host stays mounted from the drill to its result card: the bare dock hotkeys stay off through the swap.
  useDockDrillMarker()
  const progress = useProgress()
  const [visibility, pick] = useBoardVisibility()
  const [hints, pickHints] = useHints()
  const [round, setRound] = useState(targets)
  const [run, setRun] = useState(0)
  const [finished, setFinished] = useState<Finished | null>(null)
  const session = useRef<FixupSession | null>(null)
  // A new round gets a new logger and a new session. The Drill starts the logger at the first stroke.
  const logger = useMemo(() => createTestLogger(), [run])
  const title = `Fix-up · ${kind}`

  if (finished) {
    return (
      <Result
        kind={kind}
        finished={finished}
        onKeepGoing={() => {
          setRound(finished.round.filter((t) => !finished.fixed.includes(t.id)))
          setFinished(null)
          setRun((n) => n + 1)
        }}
      />
    )
  }

  if (progress.status === 'loading') return <p class="page__status">Loading…</p>

  return (
    <div class="stage0-run">
      <div class="stage0-pickers">
        <VisibilityPicker value={visibility} onPick={pick} />
        <HintPicker value={hints} onPick={pickHints} />
      </div>
      <Drill
        key={run}
        title={title}
        kind="word"
        items={round.map((t) => t.items[0])}
        logger={logger}
        logTest={{ mode: FIXUP_MODE, chapter: null, section: kind }}
        boardVisibility={visibility}
        hints={hints}
        makeSession={(clock) => {
          session.current = new FixupSession(round, clock)
          return session.current
        }}
        renderStatus={() => <Status session={session.current!} />}
        extraMeta={() => ({
          section: kind,
          targets: round.map((t) => ({ id: t.id, label: t.label })),
          fixed: session.current?.fixedIds() ?? [],
          showings: session.current?.progress().showings ?? 0,
        })}
        onDone={(result) => {
          const done = session.current!
          setFinished({ result, round, fixed: done.fixedIds(), capped: done.progress().capped })
          void progress.reload()
        }}
        onExit={() => navigate(backHref(kind))}
      />
    </div>
  )
}

function Nothing({ kind }: { kind: Kind }): JSX.Element {
  return (
    <div class="stage0-run">
      <p class="page__status" role="status">Nothing ticked is left to fix.</p>
      <p><AppLink href={backHref(kind)}>{BACK_LABEL}</AppLink></p>
    </div>
  )
}

function Ready({ kind, targets }: { kind: Kind; targets: readonly FixupTarget[] }): JSX.Element {
  return targets.length === 0 ? <Nothing kind={kind} /> : <RunHost kind={kind} targets={targets} />
}

function WordsRun({ lists, picks }: { lists: FixupLists; picks: readonly string[] }): JSX.Element {
  const targets = useMemo(() => wordTargets(lists, picks), [lists])
  return <Ready kind="words" targets={targets} />
}

function PatternsRun({ lists, picks }: { lists: FixupLists; picks: readonly string[] }): JSX.Element {
  const words = useWordLists()
  const targets = useMemo(
    () => (words.status === 'ready' ? patternTargets(lists, picks, words.lists, words.reached) : []),
    [lists, words],
  )
  if (words.status === 'loading') return <p class="page__status">Loading…</p>
  if (words.status === 'error') {
    return (
      <RunnerMessage
        text="Couldn't load the word lists. Check that the Lapwing Lab server is still running, then try again."
        href={backHref('patterns')}
        label={BACK_LABEL}
      />
    )
  }
  return <Ready kind="patterns" targets={targets} />
}

/**
 * The fix-up run: the ticked items of the page (the `pick` query values) drilled one at a time until each has ten clean
 * showings in a row. Mount it with a key on the query: the picks are read once, and the targets are built once.
 */
export function FixupRun({ kind }: { kind: Kind }): JSX.Element {
  const fixup = useFixup()
  const picks = useMemo(() => new URLSearchParams(location.search).getAll('pick'), [])
  if (fixup.status === 'loading') return <p class="page__status">Loading…</p>
  if (fixup.lists === null) {
    return (
      <RunnerMessage
        text="Couldn't load the fix-up lists. Check that the Lapwing Lab server is still running, then try again."
        href={backHref(kind)}
        label={BACK_LABEL}
      />
    )
  }
  return kind === 'words' ? <WordsRun lists={fixup.lists} picks={picks} /> : <PatternsRun lists={fixup.lists} picks={picks} />
}
