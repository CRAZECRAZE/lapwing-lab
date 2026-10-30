import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { createTestLogger, getText } from '../api.ts'
import type { DrillItem } from '../core/drill.ts'
import type { ActiveGhost } from '../core/ghost.ts'
import { partsOf, planText } from '../core/realtext.ts'
import { TEXT_MODE } from '../core/runmodes.ts'
import { navigate } from '../router.ts'
import { useDockDrillMarker } from '../state/dock.tsx'
import { getPasted } from '../state/pastedtext.ts'
import { AppLink } from './AppLink.tsx'
import { Drill } from './Drill.tsx'
import type { DrillResult } from './Drill.tsx'
import { clock } from './DrillRunner.tsx'
import { GhostNote } from './GhostLine.tsx'
import { GhostPicker, useGhostChoice } from './GhostPicker.tsx'
import { HintPicker, useHints } from './HintPicker.tsx'
import { QuickNote } from './QuickNote.tsx'
import { backTarget } from './backTarget.ts'
import { useGhost } from './useGhost.ts'
import { useTextLookup } from './useTextLookup.ts'
import { VisibilityPicker, useBoardVisibility } from './VisibilityPicker.tsx'
import './practice.css'
import './text.css'

const TEXT_HREF = '/practice/text'
const PASTED = 'pasted'
const SERVER_HINT = 'Check that the Lapwing Lab server is still running, then try again.'

type Source =
  { status: 'loading' } | { status: 'error' } | { status: 'missing' } | { status: 'ready'; name: string; text: string }

/** The text to run: the pasted one from memory, or a saved one from the server (`missing` when there is none). */
function useSource(id: string): { source: Source; retry(): void } {
  const [source, setSource] = useState<Source>(() =>
    id === PASTED ? { status: 'ready', name: PASTED, text: getPasted() } : { status: 'loading' },
  )
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (id === PASTED) return
    let live = true
    setSource({ status: 'loading' })
    getText(id).then(
      (found) =>
        live &&
        setSource(found === null ? { status: 'missing' } : { status: 'ready', name: found.name, text: found.text }),
      // an id that cannot be a saved text's id is a text that is not there
      (err) => live && setSource(err instanceof RangeError ? { status: 'missing' } : { status: 'error' }),
    )
    return () => {
      live = false
    }
  }, [id, attempt])
  return { source, retry: () => setAttempt((n) => n + 1) }
}

/** A calm message in place of the drill, with a way back and, for a failed load, a retry. */
function Message({ children, retry }: { children: string; retry?: () => void }): JSX.Element {
  const back = backTarget(TEXT_HREF, 'Back to text')
  return (
    <div class="stage0-run">
      <p class="page__status" role="alert">
        {children}
        {retry && (
          <>
            {' '}
            <button type="button" class="text__link-button" onClick={retry}>
              Try again
            </button>
          </>
        )}
      </p>
      <p>
        <AppLink href={back.href}>{back.label}</AppLink>
      </p>
    </div>
  )
}

type ResultProps = {
  title: string
  result: DrillResult
  ghost: ActiveGhost | null
  nextHref: string | null
  onAgain(): void
}

/** The card after a finished part. */
function TextResult({ title, result, ghost, nextHref, onAgain }: ResultProps): JSX.Element {
  const { stats } = result
  const back = backTarget(TEXT_HREF, 'Back to text')
  return (
    <section class="stage0-run stage0-summary free-result" aria-label="Result">
      <h2 class="stage0-summary__title">{title}</h2>
      <dl class="stage0-summary__stats">
        <div>
          <dt>Accuracy</dt>
          <dd>{Math.round(stats.accuracy * 100)}%</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{Math.round(stats.wpm)} wpm</dd>
        </div>
        <div>
          <dt>Words</dt>
          <dd>{stats.completed}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{clock(stats.elapsedMs)}</dd>
        </div>
      </dl>
      <GhostNote ghost={ghost} stats={stats} />
      <QuickNote title={title} stats={stats.completed === 0 ? null : { accuracy: stats.accuracy, wpm: stats.wpm }} />
      <div class="stage0-summary__actions runner__actions">
        {nextHref && <AppLink href={nextHref}>Next part</AppLink>}
        <button type="button" class="stage0-button" onClick={onAgain}>
          Again
        </button>
        <AppLink href={back.href}>{back.label}</AppLink>
      </div>
    </section>
  )
}

type HostProps = { id: string; name: string; part: number; parts: number; items: DrillItem[] }

/** The pickers, the flowing word drill and the result card for one part. */
function RunHost({ id, name, part, parts, items }: HostProps): JSX.Element {
  // The host stays mounted from the drill to its result card: the bare dock hotkeys stay off through the swap.
  useDockDrillMarker()
  const [visibility, pick] = useBoardVisibility()
  const [hints, pickHints] = useHints()
  const [ghostChoice, pickGhost, ghostReady] = useGhostChoice()
  const [run, setRun] = useState(0)
  const [result, setResult] = useState<DrillResult | null>(null)

  const logTest = { mode: TEXT_MODE, chapter: null, section: `text/${id}/${part}` }
  const ghost = useGhost(logTest.mode, logTest.section, ghostChoice, run, ghostReady)
  // A new attempt gets a new logger. The Drill starts the logger at the first stroke.
  const logger = useMemo(() => createTestLogger(), [run])
  const title = `Text · ${name} · part ${part}`

  if (result) {
    return (
      <TextResult
        title={title}
        result={result}
        ghost={ghost}
        nextHref={part < parts ? `/practice/text/run/${id}/${part + 1}` : null}
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
        <HintPicker value={hints} onPick={pickHints} />
        <GhostPicker value={ghostChoice} onPick={pickGhost} />
      </div>
      <div class="text-run__where">
        <p class="text-run__name">{name === PASTED ? 'Pasted text' : name}</p>
        <p class="text-run__part">{`Part ${part} of ${parts}`}</p>
        <p class="text-run__count">{`${items.length} ${items.length === 1 ? 'word' : 'words'} in this part`}</p>
      </div>
      <Drill
        key={run}
        title={title}
        kind="word"
        items={items}
        logger={logger}
        logTest={logTest}
        boardVisibility={visibility}
        hints={hints}
        ghost={ghost}
        view="flow"
        onDone={setResult}
        onExit={() => navigate(backTarget(TEXT_HREF, 'Back to text').href)}
      />
    </div>
  )
}

/**
 * The `/practice/text/run/<id>/<part>` route: one part (100 words) of the pasted text or a saved one, in text order.
 * Mount it with a key on `id/part`: the text and its plan are read once.
 */
export function TextRun({ id, part }: { id: string; part: number }): JSX.Element {
  const { source, retry } = useSource(id)
  const { lookup, retry: retryLookup } = useTextLookup()
  const plan = useMemo(
    () => (source.status === 'ready' && lookup.status === 'ready' ? planText(source.text, lookup.lookup) : null),
    [source, lookup],
  )
  const parts = useMemo(() => (plan ? partsOf(plan.items) : []), [plan])

  if (source.status === 'error') return <Message retry={retry}>{`Couldn't load the text. ${SERVER_HINT}`}</Message>
  if (source.status === 'missing') return <Message>There is no saved text with that name.</Message>
  if (lookup.status === 'error')
    return <Message retry={retryLookup}>{`Couldn't load the dictionary. ${SERVER_HINT}`}</Message>
  if (source.status === 'loading' || lookup.status === 'loading' || !plan) return <p class="page__status">Loading…</p>
  if (source.text.trim() === '') return <Message>There is no pasted text here.</Message>
  if (parts.length === 0) return <Message>This text has no words to practise.</Message>
  if (part > parts.length) return <Message>{`This text has no part ${part}.`}</Message>
  return <RunHost id={id} name={source.name} part={part} parts={parts.length} items={parts[part - 1]} />
}
