import type { JSX } from 'preact'
import { useMemo } from 'preact/hooks'
import type { StrokeRecord, TestRow } from '../../../server/archive.ts'
import { dateTickOffsets, labelsThatFit, niceMax, num, scaleLinear, stripCeiling, textWidth, ticks } from '../../core/chartmath.ts'
import { quarterWpm, RHYTHM_DEFAULTS, runRhythm } from '../../core/rhythm.ts'
import type { Rhythm } from '../../core/rhythm.ts'
import { completedWords } from '../../core/words.ts'
import { ChartSvg, DataTable, Grid, Tip, useChartPoints, VIEW_H, VIEW_W, XLabels } from './Chart.tsx'
import type { Box, Margins } from './Chart.tsx'
import '../progress.css'

type RunInfo = Pick<TestRow, 'wpm' | 'accuracy' | 'meta' | 'mode'>
type StrokeInfo = Pick<StrokeRecord, 'tsMs' | 'correct' | 'latencyMs'>

// The strip: room on the left for the seconds, under for the stroke numbers and their title.
const STRIP_MARGINS: Margins = { l: 52, r: 12, t: 22, b: 28 }
/** The wide drawing has no axis inside it: that is the drawing of its own beside the scrolling box. */
const WIDE_MARGINS: Margins = { l: 6, r: 12, t: 22, b: 28 }
const AXIS_W = 52
/** Words `break` over the dotted lines are at least this far apart (drawing units). */
const BREAK_WORD_ROOM = 40
/** A run with more strokes than this is drawn wider than its container, this many units per stroke, and scrolls. */
const MAX_FIT = 300
const WIDE_SLOT = 3
const QUARTER_MARGINS: Margins = { l: 46, r: 12, t: 24, b: 30 }
const QUARTER_NAMES = ['1st', '2nd', '3rd', '4th']

const CHAPTER_NOTE =
  "A chapter test shows each word three times in a row. The pause before a word's first showing includes reading time, and the stalls and the steadiness count it, so compare this score with other chapter tests, not with free type."

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** `0.6 s`, `3.2 s`, `12 s`: a pause to read in a label; two decimals under a tenth of a second. */
function pause(ms: number): string {
  const s = Number.isFinite(ms) ? Math.max(0, ms) / 1000 : 0
  return `${s >= 10 ? Math.round(s) : s >= 0.1 ? s.toFixed(1) : s.toFixed(2)} s`
}

const seconds2 = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(2)} s`
const tickSeconds = (s: number): string => `${Math.round(s * 1000) / 1000} s`

/**
 * The rhythm of one run: four figures, the strip of pauses before each stroke, and the speed in each quarter.
 * Shared by the Progress panel and the History run page. `strokes` are the run's strokes in order.
 */
export function RhythmView({ test, strokes }: { test: RunInfo; strokes: readonly StrokeInfo[] }): JSX.Element {
  const rhythm = useMemo(
    () => runRhythm(strokes.map((s) => ({ tsMs: s.tsMs, correct: s.correct, latencyMs: s.latencyMs }))),
    [strokes],
  )
  const words = useMemo(() => completedWords(test.wpm, test.accuracy, test.meta), [test.wpm, test.accuracy, test.meta])
  // a run with no words has no speed to share out: every quarter is unknown
  const quarters = useMemo(() => (words > 0 ? quarterWpm(rhythm, words) : [null, null, null, null]), [rhythm, words])

  if (rhythm.gaps.length === 0) return <p class="progress__muted">No strokes recorded for this run.</p>

  const scoredGaps = rhythm.gaps.length - rhythm.breaks
  const first = quarters[0]
  const last = quarters[3]
  const change = first !== null && last !== null ? last - first : null

  return (
    <div class="rhythm">
      <dl class="rhythm__figures">
        <div class="rhythm__figure">
          <dt>Steadiness</dt>
          <dd class="rhythm__value">{rhythm.steadiness === null ? '—' : `${rhythm.steadiness} / 100`}</dd>
          <dd class="rhythm__meaning">
            {rhythm.steadiness === null ? 'not enough strokes to score' : 'How evenly your strokes were spaced. Higher is steadier.'}
          </dd>
        </div>
        <div class="rhythm__figure">
          <dt>Stalls</dt>
          <dd class="rhythm__value">{rhythm.stalls}</dd>
          <dd class="rhythm__meaning">Pauses much longer than your usual (more than 2.5 times, and over 1 second).</dd>
        </div>
        <div class="rhythm__figure">
          <dt>Typical gap</dt>
          <dd class="rhythm__value">{rhythm.typicalGapMs === null ? '—' : seconds2(rhythm.typicalGapMs)}</dd>
          <dd class="rhythm__meaning">The middle of your pauses between strokes.</dd>
        </div>
        <div class="rhythm__figure">
          <dt>Start vs finish</dt>
          <dd class="rhythm__value">{change === null ? '—' : signedWpm(change)}</dd>
          <dd class="rhythm__meaning">Last quarter against the first, estimated.</dd>
        </div>
      </dl>
      {test.mode === 'chapter-test' && <p class="panel__note rhythm__chapternote">{CHAPTER_NOTE}</p>}
      {rhythm.steadiness === null && (
        <p class="panel__note">
          {scoredGaps < RHYTHM_DEFAULTS.minGaps
            ? 'Rhythm needs at least 10 strokes to be scored.'
            : 'Rhythm could not be scored for this run.'}
        </p>
      )}

      <Strip rhythm={rhythm} />
      <Quarters quarters={quarters} rhythm={rhythm} wpm={test.wpm} words={words} />
    </div>
  )
}

function signedWpm(diff: number): string {
  const r = Math.round(diff * 10) / 10
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${Math.abs(r).toFixed(1)} wpm`
}

function Strip({ rhythm }: { rhythm: Rhythm }): JSX.Element {
  const { gaps, typicalGapMs } = rhythm
  const n = gaps.length
  const { active, props: point } = useChartPoints(n)

  // Up to MAX_FIT strokes the drawing is scaled to its container with the seconds axis inside it. A longer run is drawn
  // at 3 px a stroke in a box that scrolls sideways, and its seconds axis is a drawing of its own beside the box, so the
  // scale stays in view while the strokes scroll.
  const wide = n > MAX_FIT
  const m: Margins = wide ? WIDE_MARGINS : STRIP_MARGINS
  const width = wide ? m.l + m.r + n * WIDE_SLOT : VIEW_W
  const box: Box = { left: m.l, right: width - m.r, top: m.t, bottom: VIEW_H - m.b }
  const slot = (box.right - box.left) / n
  const barWidth = clamp(slot * 0.7, 1.5, 14)
  const centre = (i: number): number => num(box.left + slot * (i + 0.5))

  // The scale: the tallest bar is the longest pause, but no more than 3 times the 95th percentile.
  const topSeconds = niceMax(stripCeiling(gaps.filter((g) => g.kind !== 'break').map((g) => g.ms)) / 1000)
  const y = scaleLinear([0, topSeconds], [box.bottom, box.top])
  const yOf = (ms: number): number => num(y(clamp(ms / 1000, 0, topSeconds)))
  const left = ticks(topSeconds).map((v) => ({ value: v, y: y(v), text: tickSeconds(v) }))

  const most = wide ? 60 : labelsThatFit(box.right - box.left, textWidth(String(n)), 10)
  const labels = dateTickOffsets(n - 1, most).map((i) => ({ x: centre(i), text: String(i + 1) }))

  const detail = (i: number): string => {
    const g = gaps[i]
    return `${pause(g.ms)} pause${g.kind === 'normal' ? '' : `, ${g.kind}`}`
  }
  const label = (i: number): string => `Stroke ${i + 1}: ${detail(i)}`
  const typicalY = typicalGapMs === null ? null : yOf(typicalGapMs)

  // a `break` word over the dotted line, unless another is close to it
  const breakWords = new Set<number>()
  let lastWord = -Infinity
  gaps.forEach((g, i) => {
    if (g.kind === 'break' && centre(i) - lastWord >= BREAK_WORD_ROOM) {
      breakWords.add(i)
      lastWord = centre(i)
    }
  })

  const rows = gaps.map((g, i) => ({ key: String(i), cells: [String(i + 1), (g.ms / 1000).toFixed(2), g.kind] }))
  const shown = active !== null ? gaps[active] : null
  const shownY = shown === null ? 0 : shown.kind === 'break' ? box.top : yOf(shown.ms)

  return (
    <div class="rhythm__strip">
      <h3 class="rhythm__sub">Pause before each stroke</h3>
      {typicalGapMs !== null && (
        <p class="rhythm__key">
          <span class="rhythm__sample" aria-hidden="true" /> typical {seconds2(typicalGapMs)}
        </p>
      )}
      <div class="rhythm__stripbox">
        {wide && (
          <svg class="rhythm__yaxis" viewBox={`0 0 ${AXIS_W} ${VIEW_H}`} width={AXIS_W} height={VIEW_H} aria-hidden="true">
            <g class="chart__axes">
              {left.map((t) => (
                <text key={t.value} class="chart__tick chart__tick-y" x={AXIS_W - 6} y={num(t.y + 4)} text-anchor="end">
                  {t.text}
                </text>
              ))}
            </g>
          </svg>
        )}
        <div class="rhythm__scroll" style={{ overflowX: 'auto' }}>
          <ChartSvg
            label={`Chart of the pause before each of ${plural(n, 'stroke')}`}
            width={wide ? width : undefined}
            className={wide ? 'rhythm__plot rhythm__plot--wide' : 'rhythm__plot'}
          >
            {wide ? (
              <g class="chart__axes">
                {left.map((t) => (
                  <line key={t.value} class="chart__grid" data-value={t.value} x1={box.left} x2={box.right} y1={num(t.y)} y2={num(t.y)} />
                ))}
              </g>
            ) : (
              <Grid box={box} left={left} />
            )}
            <XLabels labels={labels} y={box.bottom + 18} />
            {gaps.map((g, i) => {
              const x = centre(i)
              const isBreak = g.kind === 'break'
              const top = isBreak ? box.bottom : yOf(g.ms)
              const capped = !isBreak && g.ms / 1000 > topSeconds
              return (
                <g key={i} class="chart__hit" role="img" aria-label={label(i)} {...point(i)}>
                  <rect class="chart__column" x={num(x - Math.max(slot, 1) / 2)} y={box.top} width={num(Math.max(slot, 1))} height={num(box.bottom - box.top)} />
                  {isBreak ? (
                    <>
                      <line
                        class="rhythm__break"
                        x1={x}
                        x2={x}
                        y1={num(box.bottom)}
                        y2={num(box.top)}
                        stroke-dasharray="3 3"
                        stroke-width={num(Math.max(barWidth, 2))}
                      />
                      {breakWords.has(i) && (
                        <text
                          class="rhythm__breakword"
                          x={x}
                          y={num(box.top - 4)}
                          text-anchor={x - box.left < 20 ? 'start' : box.right - x < 20 ? 'end' : 'middle'}
                        >
                          break
                        </text>
                      )}
                    </>
                  ) : (
                    <rect
                      class={g.kind === 'stall' ? 'rhythm__bar rhythm__bar--stall' : 'rhythm__bar'}
                      x={num(x - barWidth / 2)}
                      y={top}
                      width={num(barWidth)}
                      height={num(box.bottom - top)}
                    />
                  )}
                  {capped && <line class="rhythm__capmark" x1={num(x - 3)} x2={num(x + 3)} y1={num(top - 3)} y2={num(top - 3)} />}
                </g>
              )
            })}
            {typicalY !== null && <line class="rhythm__typical" x1={box.left} x2={box.right} y1={typicalY} y2={typicalY} stroke-dasharray="6 4" />}
            {shown && <Tip x={centre(active!)} y={shownY} width={width} lines={[`Stroke ${active! + 1}`, detail(active!)]} />}
          </ChartSvg>
        </div>
      </div>
      <p class="rhythm__xtitle">Stroke number</p>
      <p class="panel__note">
        This run: {plural(rhythm.stalls, 'stall')}, {plural(rhythm.breaks, 'break')}. Each bar is the pause before one stroke; red bars are
        stalls. A dotted line marked break is a pause over 10 seconds, left out of the scores. A short line over a bar means it is taller
        than the chart. The dashed line is your typical gap.
      </p>
      <DataTable
        lazy
        caption="The pause before each stroke of the run, in seconds."
        head={['Stroke', 'Pause (s)', 'Kind']}
        rows={rows}
      />
    </div>
  )
}

function Quarters({
  quarters,
  rhythm,
  wpm,
  words,
}: {
  quarters: (number | null)[]
  rhythm: Rhythm
  wpm: number | null
  words: number
}): JSX.Element {
  const known = quarters.some((q) => q !== null)
  const { active, props: point } = useChartPoints(4)
  const title = <h3 class="rhythm__sub">Speed through the run (estimated wpm)</h3>
  if (rhythm.quarters === null || words <= 0 || !known) {
    return (
      <div class="rhythm__quarters">
        {title}
        <p class="progress__muted">not enough strokes to show the quarters</p>
      </div>
    )
  }
  const box = { left: QUARTER_MARGINS.l, right: VIEW_W - QUARTER_MARGINS.r, top: QUARTER_MARGINS.t, bottom: VIEW_H - QUARTER_MARGINS.b }
  const top = niceMax(Math.max(...quarters.map((q) => q ?? 0)))
  const y = scaleLinear([0, top], [box.bottom, box.top])
  const slot = (box.right - box.left) / 4
  const barWidth = slot * 0.5
  const centre = (i: number): number => num(box.left + slot * (i + 0.5))
  const text = (q: number | null): string => (q === null ? '—' : q.toFixed(1))
  const left = ticks(top).map((v) => ({ value: v, y: y(v), text: String(v) }))
  const name = (i: number): string => `${QUARTER_NAMES[i]} quarter: ${quarters[i] === null ? '— (not enough strokes)' : `${text(quarters[i])} wpm, estimated`}`
  const rows = quarters.map((q, i) => ({
    key: QUARTER_NAMES[i],
    cells: [QUARTER_NAMES[i], text(q), String(rhythm.quarters![i].correct)],
  }))
  const shown = active !== null ? quarters[active] : null

  return (
    <div class="rhythm__quarters">
      {title}
      <div class="rhythm__qrow">
        <div class="rhythm__qchart">
          <ChartSvg label="Chart of the estimated speed in each quarter of the run">
            <Grid box={box} left={left} />
            <XLabels labels={QUARTER_NAMES.map((t, i) => ({ x: centre(i), text: t }))} y={box.bottom + 20} />
            {quarters.map((q, i) => (
              <g key={i} class="chart__hit" role="img" aria-label={name(i)} {...point(i)}>
                <rect class="chart__column" x={num(centre(i) - slot / 2)} y={box.top} width={num(slot)} height={num(box.bottom - box.top)} />
                {q === null ? (
                  <text class="rhythm__qvalue rhythm__qnone" x={centre(i)} y={num(box.bottom - 8)} text-anchor="middle">
                    —
                  </text>
                ) : (
                  <>
                    <rect class="chart__bar rhythm__qbar" x={num(centre(i) - barWidth / 2)} y={num(y(q))} width={num(barWidth)} height={num(box.bottom - y(q))} />
                    <text class="rhythm__qvalue" x={centre(i)} y={num(y(q) - 6)} text-anchor="middle">
                      {text(q)}
                    </text>
                  </>
                )}
              </g>
            ))}
            {shown !== null && active !== null && (
              <Tip x={centre(active)} y={y(shown)} lines={[`${QUARTER_NAMES[active]} quarter`, `${text(shown)} wpm, estimated`]} />
            )}
          </ChartSvg>
        </div>
        <div class="rhythm__qside">
          <p class="panel__best">Whole run: {wpm === null || !Number.isFinite(wpm) ? '—' : `${wpm.toFixed(1)} wpm`} (counted by the app)</p>
          <p class="panel__note">
            The quarters share the run's words across the run in proportion to your correct strokes, so they are estimates.
          </p>
        </div>
      </div>
      <DataTable
        lazy
        caption="Estimated speed in each quarter of the run (equal slices of active time)."
        head={['Quarter', 'Estimated wpm', 'Correct strokes']}
        rows={rows}
      />
    </div>
  )
}
