import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ChapterInfo } from '../../scripts/build-content.ts'
import type { SectionResult } from '../../server/archive.ts'
import { CHAPTER_TEST, drillPassMark } from '../core/chaptertest.ts'
import { formatAccuracy, formatWpm } from '../core/format.ts'
import { blockingChapters, chapterList, requirementText } from '../core/progress.ts'
import type { ChapterState } from '../core/progress.ts'
import { useProgress } from '../state/progress.tsx'
import { isPlainClick, navigate } from '../router.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import './chapterpanel.css'

/** `5-basic-left-hand` → `basic left hand`. */
export function drillName(listId: string): string {
  return listId.replace(/^\d+-/, '').replace(/-/g, ' ')
}

type Marks = { accuracy: number; minWpm?: number }

/** `92% · 31 wpm` for one result; against a pass mark, a score just below it keeps one decimal (`89.6%`). */
export function describeScore(score: { accuracy: number; wpm: number }, marks?: Marks): string {
  return `${formatAccuracy(score.accuracy, marks?.accuracy)} · ${formatWpm(score.wpm, marks?.minWpm)}`
}

/**
 * The pass mark a score of this kind is shown against: the chapter test's and Stage 0's own, the 90% of a
 * `drills` chapter's section lists, and none for anything that is only practice.
 */
export function scoreMarks(info: ChapterInfo | undefined, kind: 'stage0' | 'test' | 'section'): Marks | undefined {
  if (!info) return undefined
  const gate = kind === 'section' ? 'drills' : kind
  return info.gate === gate ? drillPassMark(info) : undefined
}

const scoreText = (label: string, score: { accuracy: number; wpm: number } | null | undefined, marks?: Marks): string =>
  `${label}: ${score ? describeScore(score, marks) : '—'}`

function statusText(state: ChapterState | undefined): string {
  if (state?.cleared) {
    switch (state.how) {
      case 'passed':
        return 'Cleared · passed the test'
      case 'drills':
        return 'Cleared · every drill done'
      case 'read':
        return 'Cleared · marked read'
      default:
        return 'Cleared · moved on anyway'
    }
  }
  if (state?.locked) return lockText(state)
  return 'Open'
}

const lockText = (state: ChapterState): string => `Locked until Chapter ${state.blockedBy} is cleared`

function InAppLink({ href, class: className, children }: { href: string; class: string; children: string }): JSX.Element {
  return (
    <a
      class={className}
      href={href}
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

function DrillRows({ info, results, ticks }: { info: ChapterInfo; results: SectionResult[]; ticks: boolean }): JSX.Element {
  const progress = useProgress()
  const marks = scoreMarks(info, 'section')
  return (
    <ul class="chapter-panel__list">
      {info.listIds.map((id) => {
        const result = results.find((r) => r.section === id)
        const count = progress.index.find((e) => e.id === id)?.items
        return (
          <li key={id} class="chapter-panel__row">
            <span class="chapter-panel__tick">{ticks && result?.passed ? '✓' : ''}</span>
            <span class="chapter-panel__name">{drillName(id)}</span>
            {count !== undefined && <span class="chapter-panel__count">{` · ${count} words`}</span>}
            <span class="chapter-panel__last">{result?.last ? scoreText('Last', result.last, marks) : '—'}</span>
            <InAppLink class="chapter-panel__start" href={`/drill/list/${encodeURIComponent(id)}`}>
              Start
            </InAppLink>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Which "Are you sure?" is open: moving on from this chapter, or opening it past `chapters` (fixed when the dialog
 * opens, so its text does not change while the write lands).
 */
type Asking = { kind: 'move' } | { kind: 'open'; chapters: number[] } | null

/** The chapter's progress on its own page: status, requirement, drills, the chapter test, and the marks. */
export function ChapterPanel({ chapter }: { chapter: number }): JSX.Element | null {
  const progress = useProgress()
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [asking, setAsking] = useState<Asking>(null)
  const live = useRef(true)

  useLayoutEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  if (progress.status === 'loading') return null
  if (progress.status === 'error') {
    return (
      <section class="chapter-panel chapter-panel--quiet" aria-label="Chapter progress">
        <p class="chapter-panel__quiet">
          Chapter progress isn't available right now.{' '}
          <button type="button" class="stage0-button" onClick={() => void progress.reload()}>
            Try again
          </button>
        </p>
      </section>
    )
  }

  const info = progress.chapters.find((c) => c.chapter === chapter)
  if (!info) return null
  const state = progress.states.get(chapter)
  const cleared = state?.cleared === true
  const locked = state?.locked === true && state.blockedBy !== undefined

  const write = (action: () => Promise<void>): void => {
    if (saving) return
    setSaving(true)
    setFailed(false)
    // Either way the dialog, if one asked, closes once the write has finished.
    action().then(
      () => {
        if (!live.current) return
        setSaving(false)
        setAsking(null)
      },
      () => {
        if (!live.current) return
        setSaving(false)
        setAsking(null)
        setFailed(true)
      },
    )
  }

  const askOpen = (): void => {
    const blocking = blockingChapters(progress.states, chapter)
    setAsking({ kind: 'open', chapters: blocking.length > 0 ? blocking : [state!.blockedBy!] })
  }

  const { results } = progress
  const test = info.gate === 'test' && info.testListId !== undefined
    ? results['chapter-test'].find((r) => r.section === info.testListId)
    : undefined
  const testCount = info.testListId !== undefined ? progress.index.find((e) => e.id === info.testListId)?.items : undefined
  const testWords = Math.min(CHAPTER_TEST.words, testCount ?? CHAPTER_TEST.words)
  const stage0 = info.gate === 'stage0' ? results.stage0.find((r) => r.section === 'pseudo-test') : undefined
  const testMarks = scoreMarks(info, 'test')
  const stage0Marks = scoreMarks(info, 'stage0')

  return (
    <section class="chapter-panel" aria-label="Chapter progress">
      <p class={cleared ? 'chapter-panel__status chapter-panel__status--cleared' : 'chapter-panel__status'}>
        {statusText(state)}
      </p>
      <p class="chapter-panel__requirement">{requirementText(info)}</p>
      {cleared && locked && <p class="chapter-panel__lock">{lockText(state!)}</p>}

      {stage0 && (
        <p class="chapter-panel__scores">
          {scoreText('Best', stage0.best, stage0Marks)} <span aria-hidden="true">·</span> {scoreText('Last', stage0.last, stage0Marks)}
        </p>
      )}

      {(info.gate === 'drills' || info.gate === 'test') && info.listIds.length > 0 && (
        <DrillRows info={info} results={results.section} ticks={info.gate === 'drills'} />
      )}

      {info.gate === 'test' && info.testListId !== undefined && (
        <div class="chapter-panel__test">
          <p class="chapter-panel__test-head">
            <span class="chapter-panel__tick">{test?.passed ? '✓' : ''}</span>
            <span class="chapter-panel__name">Chapter test</span>
            <span class="chapter-panel__count">{` · ${testWords} words, ${CHAPTER_TEST.repetitions} times each`}</span>
          </p>
          <p class="chapter-panel__scores">
            {scoreText('Best', test?.best, testMarks)} <span aria-hidden="true">·</span> {scoreText('Last', test?.last, testMarks)}
          </p>
          <InAppLink class="chapter-panel__take" href={`/drill/test/${chapter}`}>
            Take the chapter test
          </InAppLink>
        </div>
      )}

      <div class="chapter-panel__actions">
        {info.gate === 'read' && !cleared && (
          <button type="button" class="stage0-button" disabled={saving} onClick={() => write(() => progress.setMark(chapter, 'read'))}>
            Mark as read
          </button>
        )}
        {!cleared && !locked && chapter >= 4 && (
          <button type="button" class="stage0-button" disabled={saving} onClick={() => setAsking({ kind: 'move' })}>
            Move on anyway
          </button>
        )}
        {cleared && (state!.how === 'override' || state!.how === 'read') && (
          <button type="button" class="stage0-button" disabled={saving} onClick={() => write(() => progress.clearMark(chapter))}>
            Undo
          </button>
        )}
        {locked && (
          <button type="button" class="stage0-button" disabled={saving} onClick={askOpen}>
            Open anyway
          </button>
        )}
      </div>
      {failed && (
        <p class="chapter-panel__error" role="alert">
          Couldn't save that. Try again.
        </p>
      )}
      {asking?.kind === 'move' && (
        <ConfirmDialog
          title="Move on anyway?"
          message={`Mark Chapter ${chapter} as done without clearing it? You can undo this later.`}
          confirmLabel="Move on anyway"
          busy={saving}
          onConfirm={() => write(() => progress.setMark(chapter, 'override'))}
          onCancel={() => setAsking(null)}
        />
      )}
      {asking?.kind === 'open' && (
        <ConfirmDialog
          title={`Open Chapter ${chapter} anyway?`}
          message={`${chapterList(asking.chapters)} will be marked as moved on anyway so Chapter ${chapter} opens. You can undo each one later.`}
          confirmLabel="Open anyway"
          busy={saving}
          onConfirm={() => write(() => progress.setMarks(asking.chapters, 'override'))}
          onCancel={() => setAsking(null)}
        />
      )}
    </section>
  )
}
