import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { PracticeIndexEntry } from '../../scripts/build-content.ts'
import type { PracticeList } from '../../scripts/lib/practice.ts'
import type { Stage0Words } from '../../scripts/lib/stage0.ts'
import { createTestLogger } from '../api.ts'
import type { DrillItem } from '../core/drill.ts'
import { PSEUDO_SOURCE, buildFreeItems, describeFree, itemCountFor, listIdsFor, parseMode, parseSource, poolFor } from '../freetype/free.ts'
import type { FreeMode, FreeSource } from '../freetype/free.ts'
import { isPlainClick, navigate } from '../router.ts'
import { Drill } from './Drill.tsx'
import type { DrillResult } from './Drill.tsx'
import { HintPicker, useHints } from './HintPicker.tsx'
import { QuickNote } from './QuickNote.tsx'
import { VisibilityPicker, useBoardVisibility } from './VisibilityPicker.tsx'
import './practice.css'

const PRACTICE_HREF = '/practice'
const CHAPTER_SOURCE = /^ch-\d+$/

type Data =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unknown' }
  | { status: 'ready'; source: FreeSource; pool: DrillItem[] }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/** The source and its pool of items: the pseudo-words, or every list up to the source's chapter. */
async function loadSource(id: string): Promise<Data> {
  if (id === PSEUDO_SOURCE.id) {
    const words = await getJson<Stage0Words>('/content/stage0.json')
    return { status: 'ready', source: PSEUDO_SOURCE, pool: poolFor(PSEUDO_SOURCE, { words }) }
  }
  if (!CHAPTER_SOURCE.test(id)) return { status: 'unknown' }
  const index = await getJson<PracticeIndexEntry[]>('/content/practice-index.json')
  const source = parseSource(id, index)
  if (!source) return { status: 'unknown' }
  const lists = await Promise.all(listIdsFor(source, index).map((list) => getJson<PracticeList>(`/content/practice/${list}.json`)))
  return { status: 'ready', source, pool: poolFor(source, { lists }) }
}

function BackLink(): JSX.Element {
  return (
    <a
      href={PRACTICE_HREF}
      onClick={(e) => {
        if (!isPlainClick(e)) return
        e.preventDefault()
        navigate(PRACTICE_HREF)
      }}
    >
      Back to Practice
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

/** The card after a finished run. Kept as a column of parts so more can be added below the stats. */
function FreeResult({ title, result, onAgain }: { title: string; result: DrillResult; onAgain(): void }): JSX.Element {
  const { stats, meta } = result
  const timedOut = (meta as { timedOut?: unknown } | null)?.timedOut === true
  return (
    <section class="stage0-run stage0-summary free-result" aria-label="Result">
      <h2 class="stage0-summary__title">{title}</h2>
      {timedOut && <p class="stage0-summary__note">Time's up.</p>}
      <dl class="stage0-summary__stats">
        <div><dt>Accuracy</dt><dd>{Math.round(stats.accuracy * 100)}%</dd></div>
        <div><dt>Speed</dt><dd>{Math.round(stats.wpm)} wpm</dd></div>
        <div><dt>Words</dt><dd>{stats.completed}</dd></div>
        <div><dt>Time</dt><dd>{clock(stats.elapsedMs)}</dd></div>
      </dl>
      <QuickNote title={title} stats={stats.completed === 0 ? null : { accuracy: stats.accuracy, wpm: stats.wpm }} />
      <div class="stage0-summary__actions">
        <button type="button" class="stage0-button" onClick={onAgain}>Again</button>
        <button type="button" class="stage0-button" onClick={() => navigate(PRACTICE_HREF)}>Back to Practice</button>
      </div>
    </section>
  )
}

/** The `/practice/free/<source>/<mode>` route. */
export function FreeRoute({ source: sourceId, mode: modeId }: { source: string; mode: string }): JSX.Element {
  const mode: FreeMode | undefined = parseMode(modeId)
  const [data, setData] = useState<Data>({ status: 'loading' })
  const [visibility, pick] = useBoardVisibility()
  const [hints, pickHints] = useHints()
  const [run, setRun] = useState(0)
  const [result, setResult] = useState<DrillResult | null>(null)

  useEffect(() => {
    if (!mode) return
    let live = true
    setData({ status: 'loading' })
    loadSource(sourceId)
      .catch((): Data => ({ status: 'error' }))
      .then((next) => live && setData(next))
    return () => {
      live = false
    }
  }, [sourceId, modeId])

  // A new attempt gets a new logger and fresh items. The Drill starts the logger at the first stroke.
  const attempt = useMemo(
    () =>
      mode && data.status === 'ready' && data.pool.length > 0
        ? { logger: createTestLogger(), items: buildFreeItems(data.pool, itemCountFor(mode)) }
        : null,
    [data, run],
  )

  if (!mode) return <Message>No such free-type mode. Pick one on the Practice tab.</Message>
  if (data.status === 'loading') return <p class="page__status">Loading…</p>
  if (data.status === 'unknown') return <Message>No such word source. Pick one on the Practice tab.</Message>
  if (data.status === 'error') {
    return <Message>Couldn't load the word lists. Check that the Lapwing Lab server is still running, then try again.</Message>
  }
  if (!attempt) return <Message>This source has no words to practise yet. Pick another on the Practice tab.</Message>

  const { source } = data
  const section = `${source.id}/${mode.id}`
  const title = describeFree(section)

  if (result) {
    return (
      <FreeResult
        title={title}
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
      <div class="stage0-pickers">
        <VisibilityPicker value={visibility} onPick={pick} />
        {source.kind === 'word' && <HintPicker value={hints} onPick={pickHints} />}
      </div>
      <Drill
        key={run}
        title={title}
        kind={source.kind}
        items={attempt.items}
        logger={attempt.logger}
        logTest={{ mode: 'free', chapter: source.chapter, section }}
        boardVisibility={visibility}
        hints={hints}
        view="flow"
        timeLimitMs={mode.seconds === undefined ? undefined : mode.seconds * 1000}
        onDone={setResult}
        onExit={() => navigate(PRACTICE_HREF)}
      />
    </div>
  )
}
