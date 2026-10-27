import type { JSX } from 'preact'
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'preact/hooks'
import type { Settings } from '../../server/settings.ts'
import type { TestLogger } from '../api.ts'
import { DrillSession } from '../core/drill.ts'
import type { DrillItem, DrillStats } from '../core/drill.ts'
import { formatStroke, parseOutline, parseStroke, slotMask } from '../core/steno.ts'
import type { Slot, SlotMask } from '../core/steno.ts'
import type { RawStroke } from '../core/uni.ts'
import { useDockOpen } from '../state/dock.tsx'
import { useUni } from '../state/uni-context.tsx'
import { Board } from './Board.tsx'
import './drill.css'

export type DrillKind = 'stroke' | 'word'
export type DrillResult = { stats: DrillStats; passed: boolean | null; meta: unknown }

/** The session and the logger are fixed at mount: the parent must `key` the Drill per test/drill. */
export type DrillProps = {
  title: string
  /** stroke: the prompt IS the raw steno; word: an English word whose outline is hidden until a miss. */
  kind: DrillKind
  items: readonly DrillItem[]
  logger: TestLogger
  logTest: { mode: string; chapter: number | null; section: string | null }
  /** Pass when accuracy is at least `accuracy`, the run took at most `maxMinutes`, and it ran at `minWpm` or faster. */
  passMark?: { accuracy: number; maxMinutes?: number; minWpm?: number }
  boardVisibility?: Settings['boardVisibility']
  /** word drills: `miss` (the default) hides the needed keys until a miss, `always` shows them from the start. */
  hints?: Settings['hints']
  /** prompt: one big prompt (the default); flow: a line of the last few, the current and the next prompts. */
  view?: 'prompt' | 'flow'
  /** Ends the drill after this much session-clock time from the first judged stroke. */
  timeLimitMs?: number
  onDone(result: DrillResult): void
  onExit(): void
}

const BOARD_KEY_PX = 22
/** A logger.finish that never settles must not trap the owner on the last screen. */
const FINISH_WAIT_MS = 1500
/** How often a running countdown redraws and checks for time-up. */
const COUNTDOWN_TICK_MS = 250
/** Flow view: completed prompts kept on the line behind the current one, and upcoming ones after it. */
const FLOW_BEHIND = 3
const FLOW_AHEAD = 10

type Miss = { missing: SlotMask; extra: SlotMask; expected: string; target: SlotMask }

const maskOf = (slots: readonly Slot[]): SlotMask => slotMask(...slots)

/** The strokes still to press: the first accepted outline that agrees with what is entered so far. */
function remaining(item: DrillItem | undefined, entered: readonly SlotMask[]): SlotMask[] {
  if (!item) return []
  for (const outline of item.outlines) {
    const strokes = parseOutline(outline)
    if (strokes.length > entered.length && entered.every((mask, i) => strokes[i] === mask)) {
      return strokes.slice(entered.length)
    }
  }
  return []
}

/** Whole seconds left as m:ss, rounded up so it reads 0:00 only once the time is up. */
function formatLeft(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function judge(stats: DrillStats, passMark: DrillProps['passMark']): boolean | null {
  if (!passMark) return null
  return (
    stats.accuracy >= passMark.accuracy &&
    (passMark.maxMinutes === undefined || stats.elapsedMs <= passMark.maxMinutes * 60000) &&
    (passMark.minWpm === undefined || stats.wpm >= passMark.minWpm)
  )
}

export function Drill(props: DrillProps): JSX.Element {
  const { title, kind, items, logger, boardVisibility = 'always', hints = 'miss', view = 'prompt', timeLimitMs, onExit } = props
  // Anything but a finite number above zero means no time limit.
  const limit =
    typeof timeLimitMs === 'number' && Number.isFinite(timeLimitMs) && timeLimitMs > 0 ? timeLimitMs : undefined
  const uni = useUni()
  // A dock tool open pauses the drill like an unplugged board: no strokes, no clock.
  const dockOpen = useDockOpen()
  const paused = dockOpen || !uni.connected
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const [unsaved, setUnsaved] = useState(logger.unsaved)
  const [hovering, setHovering] = useState(false)

  // The stroke handler is subscribed once, so it reads the latest props through this ref.
  const latest = useRef(props)
  latest.current = props
  const dockOpenNow = useRef(dockOpen)
  dockOpenNow.current = dockOpen

  // Session clock without paused time: frozen from the unplug (or the tool opening) until both are over.
  const pausedTotal = useRef(0)
  const pausedSince = useRef<number | null>(paused ? Date.now() : null)
  const clock = (): number => (pausedSince.current ?? Date.now()) - pausedTotal.current
  const sessionRef = useRef<DrillSession | null>(null)
  sessionRef.current ??= new DrillSession(items, clock)
  const session = sessionRef.current

  const entered = useRef<SlotMask[]>([])
  const misses = useRef(0) // misses so far on the current item
  const shownAt = useRef(clock()) // session-clock time the current item appeared
  const miss = useRef<Miss | null>(null)
  /** A word item that has been missed keeps its hint for every remaining stroke until it completes. */
  const hinted = useRef(false)
  const done = useRef(false)
  /** The test is created lazily, at the first judged stroke: opening a drill and leaving writes nothing. */
  const started = useRef(false)
  /** Session-clock time of the first judged stroke: the countdown runs from here. */
  const startedAt = useRef<number | null>(null)
  const alive = useRef(true)

  const timeLeft = (): number =>
    limit === undefined ? Infinity : limit - (startedAt.current === null ? 0 : clock() - startedAt.current)

  const root = useRef<HTMLElement>(null)
  const sink = useRef<HTMLTextAreaElement>(null)

  // Bookkeeping happens in render (idempotent ref updates), not in an effect, so the pause
  // starts and ends when the connection or dock state changes rather than a tick later. One contiguous pause
  // (disconnected, a tool open, or both) is counted once.
  if (!paused) {
    if (pausedSince.current !== null) {
      pausedTotal.current += Date.now() - pausedSince.current
      pausedSince.current = null
    }
  } else if (pausedSince.current === null) {
    pausedSince.current = Date.now()
  }

  useEffect(() => {
    if (!dockOpenNow.current) sink.current?.focus()
  }, [uni.connected])

  // The tool closed: the focus comes back to the drill.
  useLayoutEffect(() => {
    if (!dockOpen && sink.current?.isConnected) sink.current.focus()
  }, [dockOpen])

  // A layout effect: its cleanup runs synchronously at unmount (useEffect cleanups run after paint),
  // so no stroke can be logged, and onDone cannot fire, once the drill has closed.
  useLayoutEffect(() => {
    alive.current = true
    const unsubscribeUnsaved = logger.onUnsaved(setUnsaved)
    setUnsaved(logger.unsaved) // a failure may have landed since the first render

    if (session.finished) {
      // Nothing to drill: report zero stats at once and leave the archive alone.
      const stats = session.stats()
      const passed = judge(stats, latest.current.passMark)
      done.current = true
      latest.current.onDone({
        stats,
        passed,
        meta: { kind, itemCount: 0, firstTryCorrect: 0, elapsedMs: 0, passed },
      })
    }

    let countdown: ReturnType<typeof setInterval> | undefined
    const stopCountdown = (): void => {
      clearInterval(countdown)
      countdown = undefined
    }

    const finish = async (timedOut = false): Promise<void> => {
      const { passMark, onDone } = latest.current
      const stats = session.stats()
      const passed = timedOut ? null : judge(stats, passMark)
      const meta = {
        kind,
        itemCount: items.length,
        firstTryCorrect: stats.firstTryCorrect,
        elapsedMs: stats.elapsedMs,
        passed,
        ...(timedOut ? { timeLimitMs: limit, timedOut: true } : {}),
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, FINISH_WAIT_MS)
      })
      await Promise.race([logger.finish({ wpm: stats.wpm, accuracy: stats.accuracy, meta }).catch(() => {}), timeout])
      clearTimeout(timer)
      if (alive.current) onDone({ stats, passed, meta })
    }

    /** True (and the drill finished) once the time limit has run out. */
    const timeUp = (): boolean => {
      if (done.current || timeLeft() > 0) return done.current
      done.current = true
      stopCountdown()
      redraw(0)
      void finish(true)
      return true
    }

    const onStroke = (stroke: RawStroke): void => {
      if (dockOpenNow.current) return
      if (timeUp()) return
      const item = session.current
      if (!item) return
      const result = session.submit(stroke)
      if (result.kind === 'undo') {
        entered.current.pop()
        redraw(0)
        return
      }
      // A stray lone star after a miss (the habitual "undo") must not take the hint away.
      if (result.kind === 'ignored') return

      if (!started.current) {
        started.current = true
        startedAt.current = clock()
        if (limit !== undefined) {
          countdown = setInterval(() => {
            if (!timeUp()) redraw(0)
          }, COUNTDOWN_TICK_MS)
        }
        // Never awaited: input works while (or even if) the archive is slow or down.
        void logger.start({ ...latest.current.logTest, itemCount: items.length }).catch(() => {})
      }
      logger.stroke({
        tsMs: Date.now(),
        prompt: item.prompt,
        expected: item.outlines,
        pressedLevers: stroke.levers,
        pressedMask: stroke.mask,
        correct: result.kind !== 'miss',
        latencyMs: Math.max(0, clock() - shownAt.current),
        attemptNo: misses.current + 1,
      })

      if (result.kind === 'miss') {
        misses.current++
        entered.current = []
        hinted.current = true
        miss.current = {
          missing: maskOf(result.diff.missing),
          extra: maskOf(result.diff.extra),
          expected: result.expected,
          target: parseStroke(result.expected),
        }
      } else {
        miss.current = null
        if (result.kind === 'partial') {
          entered.current.push(stroke.mask)
        } else {
          entered.current = []
          misses.current = 0
          hinted.current = false
          shownAt.current = clock()
        }
      }
      redraw(0)
      if (session.finished) {
        done.current = true
        stopCountdown()
        void finish()
      }
    }

    const unsubscribeStrokes = uni.onStroke(onStroke)
    return () => {
      alive.current = false
      stopCountdown()
      unsubscribeStrokes()
      unsubscribeUnsaved()
      if (started.current && !done.current) {
        // Left mid-drill: close the test as abandoned, with the partial stats.
        done.current = true
        const stats = session.stats()
        const meta = {
          kind,
          itemCount: items.length,
          completed: stats.completed,
          firstTryCorrect: stats.firstTryCorrect,
          elapsedMs: stats.elapsedMs,
          passed: null,
          abandoned: true,
        }
        void logger.finish({ wpm: stats.wpm, accuracy: stats.accuracy, meta }).catch(() => {})
      }
    }
  }, [])

  const stats = session.stats()
  const item = session.current
  const showMiss = miss.current
  // A word's outline stays hidden until the first miss, unless the hint setting is `always`;
  // a stroke drill shows its own target.
  const wordHinted = hinted.current || hints === 'always'
  const hintStrokes = showMiss || kind === 'stroke' || wordHinted ? remaining(item, entered.current) : []
  const target = showMiss ? showMiss.target : (hintStrokes[0] ?? 0)
  const expectedText = showMiss
    ? showMiss.expected
    : kind === 'word' && wordHinted
      ? hintStrokes.map(formatStroke).join('/')
      : ''
  const flowFrom = Math.max(0, session.index - FLOW_BEHIND)
  const progress = limit === undefined ? `${stats.completed} / ${session.total}` : `${formatLeft(timeLeft())} left`
  const diff = showMiss ? { missing: showMiss.missing, extra: showMiss.extra } : undefined

  const board = <Board size={BOARD_KEY_PX} target={target} pressed={uni.pressed} diff={diff} />

  const swallow = (e: Event): void => {
    e.stopPropagation()
    const field = e.currentTarget as HTMLTextAreaElement
    if (field.value !== '') field.value = ''
  }

  return (
    <section
      class="drill"
      ref={root}
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onExit()
      }}
    >
      <header class="drill__head">
        <h2 class="drill__title">{title}</h2>
        <button
          type="button"
          class="drill__exit"
          onClick={() => {
            onExit()
            sink.current?.focus()
          }}
        >
          Exit
        </button>
      </header>

      {!uni.available && (
        <p class="drill__banner" role="status">
          Drilling needs a Chromium-based browser (Chrome, Edge, Brave) to read the board.
        </p>
      )}
      {uni.available && !uni.connected && (
        <p class="drill__banner" role="status">
          <span>Board disconnected — reconnect to continue</span>
          <button
            type="button"
            class="drill__connect"
            disabled={uni.connecting}
            onClick={() => {
              void uni.connect()
              sink.current?.focus()
            }}
          >
            {uni.connecting ? 'Connecting…' : 'Connect'}
          </button>
        </p>
      )}
      {uni.connected && dockOpen && (
        <p class="drill__banner" role="status">
          Paused while a tool is open
        </p>
      )}

      {view === 'flow' ? (
        <p class={`drill__flow drill__flow--${kind}`}>
          {items.slice(flowFrom, session.index + 1 + FLOW_AHEAD).map((it, k) => {
            const at = flowFrom + k
            const state = at < session.index ? 'done' : at === session.index ? 'current' : 'next'
            return (
              <span
                key={at}
                class={`drill__flow-word drill__flow-word--${state}`}
                aria-current={state === 'current' ? 'true' : undefined}
              >
                {it.prompt}
              </span>
            )
          })}
          {!item && <span class="drill__flow-end">✓</span>}
        </p>
      ) : (
        <div class={`drill__prompt drill__prompt--${kind}`} aria-live="polite">
          {item ? item.prompt : '✓'}
        </div>
      )}
      <p class="drill__stats">
        {progress} · acc {stats.completed > 0 ? `${Math.round(stats.accuracy * 100)}%` : '—'} · {Math.round(stats.wpm)} wpm
      </p>
      <p class="drill__expected" aria-live="polite">
        {expectedText}
      </p>

      {boardVisibility !== 'hidden' && (
        <div
          class="drill__board"
          style={{ '--s': `${BOARD_KEY_PX}px` }}
          onPointerEnter={() => setHovering(true)}
          onPointerLeave={() => setHovering(false)}
        >
          {boardVisibility === 'always' || hovering ? board : <div class="drill__board-placeholder" />}
        </div>
      )}

      <p class="drill__hint">Esc to exit</p>
      {unsaved > 0 && (
        <p class="drill__unsaved" role="status">
          ⚠ {unsaved} {unsaved === 1 ? 'stroke' : 'strokes'} not saved
        </p>
      )}

      <textarea
        ref={sink}
        class="drill__sink"
        aria-label="Stray output from the steno engine is discarded here"
        autoComplete="off"
        autoCapitalize="off"
        spellcheck={false}
        onInput={swallow}
        onKeyPress={swallow}
        onKeyUp={swallow}
        onKeyDown={(e) => {
          swallow(e)
          if (e.key === 'Escape') onExit()
          // Stray steno-engine typing (Tab, Space, Enter...) must neither move focus nor press a button.
          // Tab is always held; other keys with Ctrl/Meta/Alt are browser shortcuts (F5, Ctrl+R) and pass through.
          else if (e.key === 'Tab' || !(e.ctrlKey || e.metaKey || e.altKey)) e.preventDefault()
        }}
        onBlur={(e) => {
          // While a tool is open the focus belongs to it (its own focus moves may have no relatedTarget).
          if (dockOpenNow.current) return
          const next = e.relatedTarget as Node | null
          if (next && root.current?.contains(next)) return
          queueMicrotask(() => {
            if (sink.current?.isConnected) sink.current.focus()
          })
        }}
      />
    </section>
  )
}
