import type { JSX } from 'preact'
import type { ChapterInfo } from '../../../scripts/build-content.ts'
import type { SectionResult } from '../../../server/archive.ts'
import { drillPassMark } from '../../core/chaptertest.ts'
import { num } from '../../core/chartmath.ts'
import { formatAccuracy, formatWpm } from '../../core/format.ts'
import { useProgress } from '../../state/progress.tsx'
import type { Progress } from '../../state/progress.tsx'
import { DataTable, Panel } from './Chart.tsx'

const TITLE = 'Chapter tests (ignores the mode switch)'
const LINE = "Your best result on each chapter test, against the book's pass mark. The mode switch does not change it."

type Mark = { accuracy: number; minWpm?: number; maxMinutes?: number }
type Verdict = 'met' | 'not-yet' | 'untried'
type Row = {
  info: ChapterInfo
  mark: Mark | undefined
  best: { accuracy: number; wpm: number } | null
  verdict: Verdict
  /** Met by a run other than the best-ranked one (the most accurate), whose numbers are below the mark. */
  other: boolean
}

const finite = (n: number): boolean => Number.isFinite(n)

/** The chapter's test result: Chapter 4 is judged by the Stage 0 test, the others by their own chapter test list. */
function resultOf(info: ChapterInfo, results: Progress['results']): SectionResult | undefined {
  return info.gate === 'stage0'
    ? results.stage0.find((r) => r.section === 'pseudo-test')
    : results['chapter-test'].find((r) => r.section === info.testListId)
}

/** True when the best result is at the mark, by its raw numbers (the mark's accuracy, and its wpm when it has one). */
function reaches(best: { accuracy: number; wpm: number }, mark: Mark): boolean {
  return finite(best.accuracy) && finite(best.wpm) && best.accuracy >= mark.accuracy && (mark.minWpm === undefined || best.wpm >= mark.minWpm)
}

/**
 * Met or not. A run that passed (as the app clears the chapter, and the only judge of Stage 0's time limit) is met.
 * Otherwise the best result is held against the mark with its raw numbers, never rounded ones.
 */
function judge(info: ChapterInfo, mark: Mark | undefined, result: SectionResult | undefined): Verdict {
  const best = result?.best
  if (!result || !best) return 'untried'
  if (result.passed) return 'met'
  if (info.gate !== 'test' || !mark) return 'not-yet'
  return reaches(best, mark) ? 'met' : 'not-yet'
}

/** `90% and 10 wpm`, or `90% within 10 minutes`. */
function markText(mark: Mark | undefined): string {
  if (!mark) return '—'
  let text = `${Math.round(mark.accuracy * 100)}%`
  if (mark.minWpm !== undefined) text += ` and ${mark.minWpm} wpm`
  if (mark.maxMinutes !== undefined) text += ` within ${mark.maxMinutes} ${mark.maxMinutes === 1 ? 'minute' : 'minutes'}`
  return text
}

/** What a not-yet result falls short of, by its raw numbers: the mark's accuracy and/or its wpm. */
function shortfalls(best: Row['best'], mark: Mark | undefined, verdict: Verdict): string[] {
  if (verdict !== 'not-yet' || !best || !mark) return []
  const out: string[] = []
  if (!(best.accuracy >= mark.accuracy)) out.push(`needs ${Math.round(mark.accuracy * 100)}% accuracy`)
  if (mark.minWpm !== undefined && !(best.wpm >= mark.minWpm)) out.push(`needs ${mark.minWpm} wpm`)
  return out
}

const wpmText = (best: Row['best'], mark: Mark | undefined): string =>
  best && finite(best.wpm) ? formatWpm(best.wpm, mark?.minWpm) : '—'
const accuracyText = (best: Row['best'], mark: Mark | undefined): string =>
  best && finite(best.accuracy) ? formatAccuracy(best.accuracy, mark?.accuracy) : '—'

const VERDICT_WORD: Record<Verdict, string> = { met: 'met', 'not-yet': 'not yet', untried: 'not tried yet' }

/** The best wpm as a bar against the mark: the scale is the larger of the two, rounded up to a multiple of 5. */
function Bar({ chapter, wpm, mark, verdict }: { chapter: number; wpm: number; mark: number; verdict: Verdict }): JSX.Element {
  const best = finite(wpm) && wpm > 0 ? wpm : 0
  const scale = Math.max(5, Math.ceil(Math.max(best, mark) / 5) * 5)
  const at = (value: number): string => `${num(Math.min(100, Math.max(0, (value / scale) * 100)))}%`
  return (
    <span
      class={`ladder__bar ladder__bar--${verdict}`}
      role="img"
      aria-label={`Chapter ${chapter}: best ${formatWpm(best, mark)}, the mark is ${mark} wpm`}
    >
      <span class="ladder__fill" style={{ width: at(best) }} />
      <span class="ladder__mark" style={{ left: at(mark) }} />
    </span>
  )
}

/** Panel 8: one row per chapter with a test: the best result against the pass mark, met or not yet. Ignores the mode. */
export function Ladder(): JSX.Element | null {
  const progress = useProgress()
  if (progress.status === 'loading') {
    return (
      <Panel id="progress-ladder" title={TITLE} line={LINE}>
        <p class="progress__muted">Loading…</p>
      </Panel>
    )
  }
  if (progress.status === 'error') {
    return (
      <Panel id="progress-ladder" title={TITLE} line={LINE}>
        <p class="progress__muted" role="alert">
          Couldn't load the chapter results.{' '}
          <button type="button" class="progress__retry" onClick={() => void progress.reload()}>
            Try again
          </button>
        </p>
      </Panel>
    )
  }

  const rows: Row[] = progress.chapters
    .filter((c) => c.gate === 'test' || c.gate === 'stage0')
    .sort((a, b) => a.chapter - b.chapter)
    .map((info) => {
      const result = resultOf(info, progress.results)
      const mark = drillPassMark(info)
      const best = result?.best ?? null
      const verdict = judge(info, mark, result)
      const other = verdict === 'met' && info.gate === 'test' && mark !== undefined && best !== null && !reaches(best, mark)
      return { info, mark, best, verdict, other }
    })
  if (rows.length === 0) return null

  return (
    <Panel id="progress-ladder" title={TITLE} line={LINE}>
      <ul class="ladder__list">
        {rows.map(({ info, mark, best, verdict, other }) => {
          const minWpm = mark?.minWpm
          return (
            <li key={info.chapter} class="ladder__row" data-chapter={info.chapter} data-state={verdict}>
              <span class="ladder__name">{`Ch ${info.chapter}`}</span>
              {verdict === 'untried' ? (
                <span class="ladder__score ladder__score--none">not tried yet</span>
              ) : (
                <>
                  {minWpm !== undefined && minWpm > 0 && finite(minWpm) ? (
                    <Bar chapter={info.chapter} wpm={best!.wpm} mark={minWpm} verdict={verdict} />
                  ) : (
                    <span class="ladder__nobar" aria-hidden="true" />
                  )}
                  <span class="ladder__score">{`${wpmText(best, mark)} · ${accuracyText(best, mark)}`}</span>
                  <span class="ladder__result">
                    <span class={`ladder__verdict ladder__verdict--${verdict}`}>{VERDICT_WORD[verdict]}</span>
                    {other && <span class="ladder__other">passed on another run</span>}
                  </span>
                </>
              )}
              <span class="ladder__need">
                {shortfalls(best, mark, verdict).map((text) => (
                  <span key={text} class="ladder__short">
                    {text}
                  </span>
                ))}
                {shortfalls(best, mark, verdict).length === 0 && `needs ${markText(mark)}`}
                {other && ' · the most accurate run is below the mark, but another run passed'}
              </span>
            </li>
          )
        })}
      </ul>
      <DataTable
        caption="Chapter tests: the best result of each against the book's pass mark."
        head={['Chapter', 'Best wpm', 'Best accuracy', 'Mark', 'Result']}
        rows={rows.map(({ info, mark, best, verdict, other }) => ({
          key: String(info.chapter),
          cells: [
            `Ch ${info.chapter}`,
            verdict === 'untried' ? '—' : wpmText(best, mark),
            verdict === 'untried' ? '—' : accuracyText(best, mark),
            markText(mark),
            VERDICT_WORD[verdict] + (other ? ' (on another run)' : ''),
          ],
        }))}
      />
    </Panel>
  )
}
