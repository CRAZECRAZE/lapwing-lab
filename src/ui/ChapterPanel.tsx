import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ChapterInfo } from '../../scripts/build-content.ts'
import type { SectionResult } from '../../server/archive.ts'
import { CHAPTER_TEST } from '../core/chaptertest.ts'
import { requirementText } from '../core/progress.ts'
import type { ChapterState } from '../core/progress.ts'
import { useProgress } from '../state/progress.tsx'
import { isPlainClick, navigate } from '../router.ts'
import './chapterpanel.css'

/** `5-basic-left-hand` → `basic left hand`. */
export function drillName(listId: string): string {
  return listId.replace(/^\d+-/, '').replace(/-/g, ' ')
}

/** `92% · 31 wpm` for one result. */
export function describeScore(score: { accuracy: number; wpm: number }): string {
  return `${Math.round(score.accuracy * 100)}% · ${Math.round(score.wpm)} wpm`
}

const scoreText = (label: string, score: { accuracy: number; wpm: number } | null | undefined): string =>
  `${label}: ${score ? describeScore(score) : '—'}`

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
            <span class="chapter-panel__last">{result?.last ? scoreText('Last', result.last) : '—'}</span>
            <InAppLink class="chapter-panel__start" href={`/drill/list/${encodeURIComponent(id)}`}>
              Start
            </InAppLink>
          </li>
        )
      })}
    </ul>
  )
}

/** The chapter's progress on its own page: status, requirement, drills, the chapter test, and the marks. */
export function ChapterPanel({ chapter }: { chapter: number }): JSX.Element | null {
  const progress = useProgress()
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
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
    action().then(
      () => live.current && setSaving(false),
      () => {
        if (!live.current) return
        setSaving(false)
        setFailed(true)
      },
    )
  }

  const { results } = progress
  const test = info.gate === 'test' && info.testListId !== undefined
    ? results['chapter-test'].find((r) => r.section === info.testListId)
    : undefined
  const testCount = info.testListId !== undefined ? progress.index.find((e) => e.id === info.testListId)?.items : undefined
  const testWords = Math.min(CHAPTER_TEST.words, testCount ?? CHAPTER_TEST.words)
  const stage0 = info.gate === 'stage0' ? results.stage0.find((r) => r.section === 'pseudo-test') : undefined

  return (
    <section class="chapter-panel" aria-label="Chapter progress">
      <p class={cleared ? 'chapter-panel__status chapter-panel__status--cleared' : 'chapter-panel__status'}>
        {statusText(state)}
      </p>
      <p class="chapter-panel__requirement">{requirementText(info)}</p>
      {cleared && locked && <p class="chapter-panel__lock">{lockText(state!)}</p>}

      {stage0 && (
        <p class="chapter-panel__scores">
          {scoreText('Best', stage0.best)} <span aria-hidden="true">·</span> {scoreText('Last', stage0.last)}
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
            {scoreText('Best', test?.best)} <span aria-hidden="true">·</span> {scoreText('Last', test?.last)}
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
        {!cleared && !locked && (
          <button type="button" class="stage0-button" disabled={saving} onClick={() => write(() => progress.setMark(chapter, 'override'))}>
            Move on anyway
          </button>
        )}
        {cleared && (state!.how === 'override' || state!.how === 'read') && (
          <button type="button" class="stage0-button" disabled={saving} onClick={() => write(() => progress.clearMark(chapter))}>
            Undo
          </button>
        )}
        {locked && (
          <button
            type="button"
            class="stage0-button"
            disabled={saving}
            onClick={() => write(() => progress.setMark(state!.blockedBy!, 'override'))}
          >
            Open anyway
          </button>
        )}
      </div>
      {failed && (
        <p class="chapter-panel__error" role="alert">
          Couldn't save that. Try again.
        </p>
      )}
    </section>
  )
}
